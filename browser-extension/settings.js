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
