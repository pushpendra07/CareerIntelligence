import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsPage } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 7, title: "Magento Lead", status: "NEW", match_score: 80, score_stale: false, jd_status: "OK",
  company: { id: 1, name: "Acme", tier: null }, location: null, work_model: "UNKNOWN", experience_min: null,
  experience_max: null, salary_min: null, salary_max: null, salary_currency: null, sources: ["LINKEDIN"], posting_date: null };

const page = (items: unknown[]) => (url: URL) =>
  url.searchParams.get("size") === "1" ? { items: [], total: 1, page: 1, size: 1 } : { items, total: items.length, page: 1, size: 50 };

function listUrls(fn: { mock: { calls: unknown[][] } }): URL[] {
  return fn.mock.calls.map((c) => new URL(String(c[0]), "http://x"))
    .filter((u) => u.pathname.endsWith("/jobs") && u.searchParams.get("size") !== "1");
}

describe("status multi-select", () => {
  it("shows any combination of statuses", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Status" }));
    const box = screen.getByRole("listbox", { name: "Job statuses" });
    expect(within(box).queryByLabelText("Closed")).not.toBeInTheDocument(); // closed has its own tab
    await userEvent.click(within(box).getByLabelText("New"));
    await userEvent.click(within(box).getByLabelText("Shortlisted"));
    await userEvent.click(within(box).getByLabelText("Applied"));
    const last = listUrls(api.fn).at(-1)!;
    expect(last.searchParams.getAll("status")).toEqual(["NEW", "SHORTLISTED", "APPLIED"]);
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("3 statuses");

    await userEvent.click(within(box).getByLabelText("Shortlisted")); // untick one
    expect(listUrls(api.fn).at(-1)!.searchParams.getAll("status")).toEqual(["NEW", "APPLIED"]);
    await userEvent.click(within(box).getByRole("button", { name: "Clear" }));
    expect(listUrls(api.fn).at(-1)!.searchParams.getAll("status")).toEqual([]);
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("All statuses");
  });
});

describe("delete job", () => {
  it("asks first, then deletes", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]), "DELETE /jobs/7": { deleted: 7 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Delete Magento Lead" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    const dialog = screen.getByRole("alertdialog", { name: "Confirm delete" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/jobs/7"]);
  });

  it("warns when an application would be deleted too", async () => {
    const api = mockApi({
      "GET /jobs": page([JOB]),
      "DELETE /jobs/7": (url: URL) => url.searchParams.get("force") === "true" ? { deleted: 7 }
        : new Response(JSON.stringify({ error: { code: "conflict", message: "This job has 1 application. Deleting it deletes those too.", details: { applications: 1 } } }),
          { status: 409, headers: { "content-type": "application/json" } }),
    });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Delete Magento Lead" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/This job has 1 application\. Deleting it deletes those too\. Delete anyway\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    const urls = api.fn.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/jobs/7"));
    expect(urls.at(-1)).toContain("force=true");
  });
});
