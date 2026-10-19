// Runs on the Career Intelligence app's pages only (checked against the saved app/API address).
// Marks the page so the app shows the "Job collector" option, and relays messages between the
// app (window.postMessage) and the extension's background worker.
(async () => {
  const toPage = (msg) => window.postMessage({ source: "ci-collector", ...msg }, location.origin);
  // After the extension is reloaded or updated, this copy of the script is cut off from it
  // ("Extension context invalidated"); the page must be reloaded to get the new one.
  const alive = () => { try { return !!chrome.runtime.id; } catch { return false; } };
  const stale = (portal) => toPage({ type: "error", portal: portal || "", message: "The Job collector extension was updated — reload this page and try again." });

  let saved = {};
  try { saved = await chrome.storage.local.get(["apiUrl", "appUrl"]); } catch { return; }
  const allowed = [saved.appUrl || "http://127.0.0.1:5173", saved.apiUrl || "http://127.0.0.1:8010"].map((u) => new URL(u).origin);
  if (!allowed.includes(location.origin)) return;
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.ciCollector = version;
  toPage({ type: "hello", version });

  const send = (msg) => {
    if (!alive()) return stale(msg.portal);
    try {
      chrome.runtime.sendMessage(msg).catch(() => stale(msg.portal));
    } catch {
      stale(msg.portal);
    }
  };
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== "ci-app") return;
    if (d.type === "collect") {
      const urls = (Array.isArray(d.urls) ? d.urls : [d.url]).map(String).slice(0, 12);
      send({ type: "collect", portal: String(d.portal || ""), urls, max: Number(d.max) || 15 });
    } else if (d.type === "stop") send({ type: "stop" });
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.to === "app") toPage(msg);
  });
})();
