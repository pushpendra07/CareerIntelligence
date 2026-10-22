// Click the extension on a job page: read the job and add it to the app (duplicates are merged).
// On an application form: fill it from the app's apply kit (you check it and press Submit), then
// record the application.
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

async function hasApplicationForm(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["autofill.js"] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.ciAutofill.hasForm() });
  return !!(res && res.result);
}

/** An application form: say which job it is, fill it, then record the application. */
async function applyFlow(tab) {
  const { appUrl } = await ciSettings();
  let job = null;
  try {
    job = await ciApi(`/apply/lookup?url=${encodeURIComponent(tab.url)}`);
  } catch (e) {
    if (e.status !== 404) return show(`<h2 class="bad">Couldn't reach the app</h2><p>${esc(e.message)}</p>`);
  }
  show(`<h2>Application form found</h2>
    ${job ? `<p>For <b>${esc(job.title)}</b><br><span class="muted">${esc(job.company)} · ${jobLink(appUrl, { job_id: job.id })}</span></p>`
      : '<p class="muted">This page isn\'t linked to a job in your list: your details and answers can still be filled in.</p>'}
    <button id="fill">Fill this application</button>
    <button id="add-instead" class="secondary">Add this job instead</button>
    <p class="muted">Only empty fields are filled. Nothing is submitted: you check the form and press Submit.</p>`);
  document.getElementById("add-instead").onclick = () => addFlow(tab);
  document.getElementById("fill").onclick = () => fill(tab, job);
}

async function fill(tab, job) {
  const { appUrl } = await ciSettings();
  show('<p class="muted">Filling…</p>');
  let kit, file = null, fileError = "";
  try {
    kit = await ciApi(job ? `/jobs/${job.id}/apply-kit` : "/apply/kit");
  } catch (e) {
    return show(`<h2 class="bad">Couldn't get your details</h2><p>${esc(e.message)}</p>`);
  }
  if (kit.cv) {
    try { file = await ciFileBase64(kit.cv.download); } catch (e) { fileError = e.message; }
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [kit, file && file.b64, file && file.type, kit.cv && (kit.cv.filename || `${kit.cv.name}.pdf`)],
    func: (k, b64, type, name) => {
      let cv = null;
      if (b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        cv = new File([bytes], name || "cv.pdf", { type });
      }
      return globalThis.ciAutofill.fill(k, cv);
    },
  });
  const r = (res && res.result) || { filled: [], cvAttached: false, fileFieldFound: false };
  const fields = [...new Set(r.filled.filter((f) => f !== "CV"))];
  const cvLine = r.cvAttached ? '<p class="ok">✓ CV attached</p>'
    : r.fileFieldFound ? `<p class="warn">Attach your CV yourself${kit.cv ? `: <a href="${esc(appUrl)}${esc(kit.cv.download)}" target="_blank" rel="noopener">${esc(kit.cv.name)}</a>` : ""}${fileError ? ` (${esc(fileError)})` : ""}.</p>` : "";
  const missing = (kit.missing || []).length ? `<p class="muted">Not in your details yet: ${esc(kit.missing.join(", "))}.</p>` : "";
  show(`<h2 class="${fields.length ? "ok" : "warn"}">${fields.length ? `Filled ${fields.length} field${fields.length === 1 ? "" : "s"}` : "No empty fields recognised"}</h2>
    ${fields.length ? `<p class="muted">${esc(fields.join(", "))}</p>` : '<p class="muted">Copy from the Apply assistant on the job page instead.</p>'}
    ${cvLine}${missing}
    <p><b>Check every field</b> (filled ones are outlined green), answer the rest, then press Submit on the page.</p>
    ${job ? '<button id="record">I submitted it — record application</button>' : ""}`);
  if (job) document.getElementById("record").onclick = () => recordApplied(job, kit);
}

async function recordApplied(job, kit) {
  const { appUrl } = await ciSettings();
  try {
    const r = await ciApi(`/jobs/${job.id}/applied`, { method: "POST", body: { method: "COMPANY_SITE", cv_version_id: kit.cv ? kit.cv.version_id : null } });
    show(`<h2 class="ok">${r.created ? "Recorded" : "Already recorded"} ✓</h2>
      <p>${esc(job.title)} is marked Applied${r.follow_up_date ? `; follow up on ${esc(r.follow_up_date)}` : ""}.</p>
      <p>${jobLink(appUrl, { job_id: job.id })}</p>`);
  } catch (e) {
    show(`<h2 class="bad">Couldn't record it</h2><p>${esc(e.message)}</p>`);
  }
}

/** Not an application form: add the job on this page to the app. */
async function addFlow(tab) {
  let job;
  try {
    job = await readPage(tab.id);
  } catch (e) {
    return show(`<p class="bad">Can't read this page: ${esc(e.message)}</p>`);
  }
  if (!job || !job.title || !job.company) return form(job || { url: tab.url }, "Couldn't find the job title or company on this page — fill them in:");
  save(job);
}

async function run() {
  const { apiUrl, appUrl } = await ciSettings();
  document.getElementById("app-url").textContent = apiUrl;
  document.getElementById("api-url").value = apiUrl;
  document.getElementById("app-url-input").value = appUrl;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) return show('<p class="muted">Open a job posting (LinkedIn, Naukri, Indeed, a company careers page…), then click this button.</p>');
  let isForm = false;
  try { isForm = await hasApplicationForm(tab.id); } catch { /* a page the browser won't let us read */ }
  if (isForm) return applyFlow(tab);
  addFlow(tab);
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
