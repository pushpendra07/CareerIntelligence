// Click the extension on a job page: read the job and add it to the app (duplicates are merged).
const main = document.getElementById("main");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const show = (html) => { main.innerHTML = html; };

async function readPage(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extract.js"] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.ciExtract.detail() });
  return res && res.result;
}

function jobLink(appUrl, r) {
  return `<a href="${esc(appUrl)}/jobs/${r.job_id}" target="_blank" rel="noopener">#${r.job_id}</a>`;
}

async function save(job, opts = {}) {
  show('<p class="muted">Adding…</p>');
  const { appUrl } = await ciSettings();
  let data;
  try {
    data = await ciImport([job], opts);
  } catch (e) {
    return show(`<h2 class="bad">Couldn't reach the app</h2><p>${esc(e.message)}</p>
      <p class="muted">Is Career Intelligence running? Start it with <code>./start.sh</code>, or set the API address below.</p>`);
  }
  const r = data.results[0];
  const head = `<p><b>${esc(r.title)}</b><br><span class="muted">${esc(r.company)}</span></p>`;
  if (r.result === "new") {
    show(`<h2 class="ok">Added ${jobLink(appUrl, r)}</h2>${head}
      ${r.score != null ? `<p>Match score <span class="score">${r.score}</span></p>` : ""}
      ${job.description ? "" : '<p class="warn">No description found on this page, so the score is a guess. Open the job in the app to add it.</p>'}`);
  } else if (r.result === "duplicate" || r.result === "repeat") {
    show(`<h2>Already in your list: ${jobLink(appUrl, r)}</h2>${head}
      <p class="muted">${r.existing_title && r.existing_title !== r.title ? `Saved as “${esc(r.existing_title)}”. ` : ""}Status: ${esc((r.status || r.existing_status || "").replace(/_/g, " ").toLowerCase())}.
      This link was added to it.</p>`);
  } else if (r.result === "deleted") {
    show(`<h2 class="warn">You deleted this job before</h2>${head}<button id="anyway">Add it anyway</button>`);
    document.getElementById("anyway").onclick = () => save(job, { allow_deleted: true });
  } else {
    form(job, r.error || "Some details are missing.");
  }
}

/** Title or company not found on the page: let the user fill them in. */
function form(job, message) {
  show(`<p class="warn">${esc(message)}</p>
    <label for="f-title">Job title</label><input id="f-title" value="${esc(job.title)}">
    <label for="f-company">Company</label><input id="f-company" value="${esc(job.company)}">
    <label for="f-location">Location</label><input id="f-location" value="${esc(job.location)}">
    <label for="f-desc">Description</label><textarea id="f-desc">${esc(job.description)}</textarea>
    <button id="f-save">Add to Career Intelligence</button>`);
  document.getElementById("f-save").onclick = () => {
    const v = (id) => document.getElementById(id).value.trim();
    save({ ...job, title: v("f-title"), company: v("f-company"), location: v("f-location"), description: v("f-desc") });
  };
}

async function run() {
  const { apiUrl, appUrl } = await ciSettings();
  document.getElementById("app-url").textContent = apiUrl;
  document.getElementById("api-url").value = apiUrl;
  document.getElementById("app-url-input").value = appUrl;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) return show('<p class="muted">Open a job posting (LinkedIn, Naukri, Indeed, a company careers page…), then click this button.</p>');
  let job;
  try {
    job = await readPage(tab.id);
  } catch (e) {
    return show(`<p class="bad">Can't read this page: ${esc(e.message)}</p>`);
  }
  if (!job || !job.title || !job.company) return form(job || { url: tab.url }, "Couldn't find the job title or company on this page — fill them in:");
  save(job);
}

document.getElementById("toggle-settings").onclick = (e) => {
  e.preventDefault();
  document.getElementById("settings").hidden = !document.getElementById("settings").hidden;
};
document.getElementById("save-settings").onclick = async () => {
  await chrome.storage.local.set({ apiUrl: document.getElementById("api-url").value.trim(), appUrl: document.getElementById("app-url-input").value.trim() });
  run();
};
run();
