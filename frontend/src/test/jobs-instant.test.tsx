import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "../components/Toaster";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { JobsPage } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

const ROW = { id: 7, title: "Magento Lead", status: "NEW", match_score: 80, score_stale: false, jd_status: "OK", created_at: "2026-10-12T08:00:00Z",
  company: { id: 1, name: "Acme", tier: null }, location: "Pune", work_model: "ONSITE", experience_min: null, experience_max: null,
  salary_min: null, salary_max: null, salary_currency: null, sources: ["LINKEDIN"], posting_date: null, source_url: null };

/** A tiny server: the list shows the job only while its status is one the tab asks for. */
function server(fail = false) {
  let status = "NEW";
  return mockApi({
    "GET /jobs": (url: URL) => {
      if (url.searchParams.get("size") === "1") return { items: [], total: 0, page: 1, size: 1 };
      const items = url.searchParams.getAll("status").includes(status) ? [{ ...ROW, status }] : [];
      return { items, total: items.length, page: 1, size: 50 };
    },
    "POST /jobs/7/status": (_url: URL, init?: RequestInit) => {
      if (fail) return new Response(JSON.stringify({ error: { code: "x", message: "Server said no" } }), { status: 500 });
      status = JSON.parse(String(init?.body)).status;
      return { ok: true };
    },
  });
}

describe("status changes in the list", () => {
  it("take effect at once, and Undo brings the job back", async () => {
    const api = server();
    renderAt(<><JobsPage /><Toaster /></>, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Not relevant: Magento Lead" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Magento Lead" })).not.toBeInTheDocument());
    const note = await screen.findByText("Magento Lead → Not relevant");
    await userEvent.click(within(note.parentElement!).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("link", { name: "Magento Lead" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.body))
      .toEqual([{ status: "NOT_RELEVANT" }, { status: "NEW" }]);
  });

  it("come back if the server refuses", async () => {
    server(true);
    renderAt(<><JobsPage /><Toaster /></>, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Shortlist Magento Lead" }));
    expect(await screen.findByText("Server said no")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Magento Lead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

describe("loading", () => {
  it("shows placeholder shapes instead of a spinner", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByRole("status")).toHaveTextContent("Loading jobs…");
    renderAt(<DashboardPage />);
    expect((await screen.findAllByRole("status")).at(-1)).toHaveTextContent("Loading…");
  });
});
