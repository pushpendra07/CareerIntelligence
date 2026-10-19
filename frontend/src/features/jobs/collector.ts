import { useCallback, useEffect, useState } from "react";

/**
 * Talks to the Job collector Chrome extension (browser-extension/). Its content script marks
 * this page with `data-ci-collector="<version>"` and relays messages between the page and the
 * extension through window.postMessage (source "ci-app" -> extension, "ci-collector" -> page).
 */
export type CollectorState =
  | { phase: "idle" }
  | { phase: "running"; portal: string; message: string; found: number }
  | { phase: "done"; portal: string; jobs: unknown[]; message: string }
  | { phase: "error"; portal: string; message: string };

/** The extension version this app expects (browser-extension/manifest.json). */
export const COLLECTOR_VERSION = "1.1.1";

/** True when the installed extension is older than this app expects (it needs a reload). */
export function collectorOutdated(version: string | null): boolean {
  if (!version) return false;
  const n = (v: string) => v.split(".").map(Number);
  const [a, b] = [n(version), n(COLLECTOR_VERSION)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

/** The extension as a zip, set up for this app (GET /extension.zip). */
export function extensionDownloadUrl(): string {
  return `/api/v1/extension.zip?app=${encodeURIComponent(window.location.origin)}`;
}

export function collectorVersion(): string | null {
  return document.documentElement.dataset.ciCollector ?? null;
}

export function useCollector(onJobs: (jobs: unknown[]) => void) {
  const [version, setVersion] = useState<string | null>(collectorVersion);
  const [state, setState] = useState<CollectorState>({ phase: "idle" });

  useEffect(() => {
    // The content script may load after React: look again shortly.
    const t = window.setTimeout(() => setVersion(collectorVersion()), 800);
    const listen = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; type?: string; portal?: string; message?: string; found?: number; jobs?: unknown[]; version?: string };
      if (d?.source !== "ci-collector") return;
      if (d.type === "hello") setVersion(d.version ?? "1");
      else if (d.type === "progress") setState({ phase: "running", portal: d.portal ?? "", message: d.message ?? "", found: d.found ?? 0 });
      else if (d.type === "done") {
        setState({ phase: "done", portal: d.portal ?? "", jobs: d.jobs ?? [], message: d.message ?? "" });
        if (d.jobs?.length) onJobs(d.jobs);
      } else if (d.type === "error") setState({ phase: "error", portal: d.portal ?? "", message: d.message ?? "Something went wrong" });
    };
    window.addEventListener("message", listen);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("message", listen);
    };
  }, [onJobs]);

  const start = useCallback((portal: string, urls: string[], max: number) => {
    setState({ phase: "running", portal, message: "Opening the portal…", found: 0 });
    // `url` too: version 1.0 of the extension reads one search only.
    window.postMessage({ source: "ci-app", type: "collect", portal, urls, url: urls[0], max }, window.location.origin);
  }, []);
  const stop = useCallback(() => {
    window.postMessage({ source: "ci-app", type: "stop" }, window.location.origin);
  }, []);

  return { version, state, start, stop };
}
