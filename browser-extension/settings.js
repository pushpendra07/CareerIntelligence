// Where the app runs. Shared by the popup, the background worker and the app bridge.
const CI_DEFAULTS = { apiUrl: "http://127.0.0.1:8010", appUrl: "http://127.0.0.1:5173" };

async function ciSettings() {
  const saved = await chrome.storage.local.get(["apiUrl", "appUrl"]);
  return { apiUrl: (saved.apiUrl || CI_DEFAULTS.apiUrl).replace(/\/+$/, ""), appUrl: (saved.appUrl || CI_DEFAULTS.appUrl).replace(/\/+$/, "") };
}

/** Pages allowed to start a collection: the app's own UI (dev :5173, or the API serving the UI). */
async function ciAppOrigins() {
  const { apiUrl, appUrl } = await ciSettings();
  return [new URL(appUrl).origin, new URL(apiUrl).origin];
}

/** GET/POST JSON from the app's API; errors carry the app's message. */
async function ciApi(path, { method = "GET", body } = {}) {
  const { apiUrl } = await ciSettings();
  const r = await fetch(`${apiUrl}/api/v1${path}`, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((data.error && data.error.message) || `The app answered ${r.status}`), { status: r.status });
  return data;
}

/** A file from the app (the CV to attach) as base64, to hand to the page. */
async function ciFileBase64(path) {
  const { apiUrl } = await ciSettings();
  const r = await fetch(`${apiUrl}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Couldn't download the CV (${r.status})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), type: r.headers.get("content-type") || "application/octet-stream" };
}

async function ciImport(jobs, opts = {}) {
  const { apiUrl } = await ciSettings();
  const r = await fetch(`${apiUrl}/api/v1/jobs/agent-import`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs, ...opts }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || `The app answered ${r.status}`);
  return data;
}

/** Fill the application form in a tab from the app's apply kit (your Application details). With
 * follow, the page keeps filling its next steps as they appear. The CV is downloaded only when
 * the page has an empty file field. Returns { kit, result, fileError }. */
async function ciFillTab(tabId, jobId, follow) {
  const kit = await ciApi(jobId ? `/jobs/${jobId}/apply-kit` : "/apply/kit");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["autofill.js"] });
  let file = null, fileError = "";
  if (kit.cv) {
    const [need] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.ciAutofill.wantsCv() });
    if (need && need.result) {
      try { file = await ciFileBase64(kit.cv.download); } catch (e) { fileError = e.message; }
    }
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [kit, file && file.b64, file && file.type, kit.cv && (kit.cv.filename || `${kit.cv.name}.pdf`), !!follow],
    func: (k, b64, type, name, keepGoing) => {
      let cv = null;
      if (b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        cv = new File([bytes], name || "cv.pdf", { type });
      }
      return keepGoing ? globalThis.ciAutofill.follow(k, cv) : globalThis.ciAutofill.fill(k, cv);
    },
  });
  return { kit, result: (res && res.result) || { filled: [], cvAttached: false, fileFieldFound: false }, fileError };
}
