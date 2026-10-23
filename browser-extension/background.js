// Collector: the app asks for a portal search; open it in a tab, read the job links, open each
// job, read it, and send the jobs back to the app page (which checks them for duplicates before
// the user adds them). One collection at a time; a few seconds between pages.
importScripts("settings.js");

const PORTAL_HOSTS = ["www.linkedin.com", "www.naukri.com", "in.indeed.com", "www.foundit.in", "www.glassdoor.co.in",
  "www.instahyre.com", "wellfound.com", "cutshort.io", "www.hirist.tech", "www.iimjobs.com", "www.shine.com", "www.timesjobs.com"];
const PAUSE_MS = 2500;
let running = null; // { appTab, portal, stop }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tell = (tabId, msg) => chrome.tabs.sendMessage(tabId, { to: "app", ...msg }).catch(() => {});

function loaded(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listen); clearTimeout(timer); resolve(); };
    const listen = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const timer = setTimeout(done, 30000);
    chrome.tabs.onUpdated.addListener(listen);
  });
}

async function inject(tabId, func) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extract.js"] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return res && res.result;
}

/** Job links from one search page (results load as you scroll). */
async function linksFrom(tabId, url, want, job) {
  await chrome.tabs.update(tabId, { url });
  await loaded(tabId);
  await sleep(PAUSE_MS + 1500);
  let links = [];
  for (let i = 0; i < 4 && links.length < want && !job.stop; i++) {
    links = (await inject(tabId, () => globalThis.ciExtract.searchLinks())) || [];
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const list = document.querySelector(".jobs-search-results-list, .scaffold-layout__list > div, [class*='jobs-search-results']");
      (list || document.scrollingElement).scrollBy(0, 2500);
    } });
    await sleep(1500);
  }
  return links;
}

/** Several searches (remote India, then each city): share the jobs between them. */
async function collect(appTab, portal, searchUrls, max) {
  const job = { appTab, portal, stop: false };
  running = job;
  let tab;
  try {
    tab = await chrome.tabs.create({ url: "about:blank", active: true });
    const share = Math.ceil(max / searchUrls.length);
    let links = [];
    for (const [i, url] of searchUrls.entries()) {
      if (job.stop) break;
      tell(appTab, { type: "progress", portal, message: `Reading search ${i + 1} of ${searchUrls.length}…`, found: 0 });
      const found = await linksFrom(tab.id, url, share, job);
      links.push(...found.filter((l) => !links.includes(l)).slice(0, share));
    }
    links = links.slice(0, max);
    if (!links.length) throw new Error(`No job links found on ${portal}. Are you logged in, and does the search show results?`);
    const jobs = [];
    for (const [i, link] of links.entries()) {
      if (job.stop) break;
      tell(appTab, { type: "progress", portal, message: `Reading job ${i + 1} of ${links.length}…`, found: jobs.length });
      await chrome.tabs.update(tab.id, { url: link });
      await loaded(tab.id);
      await sleep(PAUSE_MS);
      const detail = await inject(tab.id, () => globalThis.ciExtract.detail()).catch(() => null);
      if (detail && detail.title) jobs.push({ ...detail, url: link, portal });
    }
    tell(appTab, { type: "done", portal, jobs, message: `${jobs.length} job${jobs.length === 1 ? "" : "s"} read from ${portal}${job.stop ? " (stopped)" : ""}.` });
  } catch (e) {
    tell(appTab, { type: "error", portal, message: e.message || String(e) });
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    chrome.tabs.update(appTab, { active: true }).catch(() => {});
    running = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab || !sender.url) return;
  (async () => {
    if (!(await ciAppOrigins()).includes(new URL(sender.url).origin)) return; // only the app may ask
    if (msg.type === "stop") { if (running) running.stop = true; return; }
    if (msg.type !== "collect") return;
    const urls = [];
    for (const raw of msg.urls || []) {
      let url;
      try { url = new URL(raw); } catch { url = null; }
      if (!url || url.protocol !== "https:" || !PORTAL_HOSTS.includes(url.hostname)) {
        return tell(sender.tab.id, { type: "error", portal: msg.portal, message: "That portal isn't supported." });
      }
      urls.push(url.href);
    }
    if (!urls.length) return tell(sender.tab.id, { type: "error", portal: msg.portal, message: "Nothing to search." });
    if (running) return tell(sender.tab.id, { type: "error", portal: msg.portal, message: `Already collecting from ${running.portal}.` });
    collect(sender.tab.id, msg.portal, urls, Math.min(Math.max(msg.max, 1), 50));
  })();
});
