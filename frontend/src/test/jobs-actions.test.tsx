import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobComments } from "../features/jobs/JobComments";
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
    await userEvent.click(within(box).getByRole("button", { name: "Select all" }));
    const all = within(box).getAllByRole("checkbox") as HTMLInputElement[];
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((c) => c.checked)).toBe(true); // every box shows as ticked
    expect(listUrls(api.fn).at(-1)!.searchParams.getAll("status")).toHaveLength(all.length);
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("All statuses");
    await userEvent.click(within(box).getByLabelText("New")); // untick one from "all"
    expect(listUrls(api.fn).at(-1)!.searchParams.getAll("status")).not.toContain("NEW");
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent(`${all.length - 1} statuses`);

    await userEvent.click(within(box).getByRole("button", { name: "Clear" }));
    const cleared = listUrls(api.fn).at(-1)!.searchParams.getAll("status");
    expect(cleared).toContain("NEW");
    expect(cleared).not.toContain("NOT_RELEVANT"); // hidden unless picked
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("All except applied, rejected, not relevant");
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

describe("sorting and page size", () => {
  it("sorts by clicking column headers and shows 10 per page", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await screen.findByText("Magento Lead");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("size")).toBe("10");

    await userEvent.click(screen.getByRole("button", { name: "Sort by posted" }));
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("-posting_date"); // newest first
    await userEvent.click(screen.getByRole("button", { name: "Sort by posted" }));
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("posting_date"); // reversed
    expect(screen.getByRole("columnheader", { name: /Posted/ })).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: "Sort by company" }));
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("company");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("company"); // dropdown in sync
  });
});

describe("added via", () => {
  it("shows how each job came in and filters by it", async () => {
    const api = mockApi({ "GET /jobs": page([{ ...JOB, added_via: ["scanner", "sheet"] }]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByTitle("Added via Job scanner")).toHaveTextContent("Job scanner");
    expect(screen.getByTitle("Added via Google Sheet")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Added via" }), "career_ops");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("added_via")).toBe("career_ops");
  });
});

describe("job id", () => {
  it("shows the job ID and sorts by it", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByTitle("Job ID")).toHaveTextContent("#7");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "-id");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("-id");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "id");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("id");
  });
});

describe("remembered sort and filters", () => {
  it("keeps the sort and filters you picked until Reset", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    const first = renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await screen.findByText("Magento Lead");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("-match_score");
    await userEvent.click(screen.getByRole("button", { name: "Sort by posted" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Score" })).getByRole("button", { name: "70+" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Work" })).getByRole("button", { name: "Remote" }));
    first.unmount();

    // Coming back later: same sort and filters, without anything in the link.
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await screen.findByText("Magento Lead");
    let last = listUrls(api.fn).at(-1)!;
    expect(last.searchParams.get("sort")).toBe("-posting_date");
    expect(last.searchParams.get("min_score")).toBe("70");
    expect(last.searchParams.get("work_model")).toBe("REMOTE");
    expect(within(screen.getByRole("group", { name: "Score" })).getByRole("button", { name: "70+" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    last = listUrls(api.fn).at(-1)!;
    expect(last.searchParams.get("sort")).toBe("-match_score");
    expect(last.searchParams.get("min_score")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("a link with filters wins, but your sort still applies", async () => {
    window.localStorage.setItem("jobs.sort.v1", "company");
    window.localStorage.setItem("jobs.filters.v1", "work_model=ONSITE");
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?min_score=80" });
    await screen.findByText("Magento Lead");
    const last = listUrls(api.fn).at(-1)!;
    expect(last.searchParams.get("min_score")).toBe("80");
    expect(last.searchParams.get("work_model")).toBeNull();
    expect(last.searchParams.get("sort")).toBe("company");
  });

  it("posted-within sends a date", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await screen.findByText("Magento Lead");
    await userEvent.click(within(screen.getByRole("group", { name: "Posted" })).getByRole("button", { name: "7 days" }));
    const after = listUrls(api.fn).at(-1)!.searchParams.get("posted_after")!;
    const days = (Date.now() - new Date(after).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8.5);
  });
});

describe("next step in the list", () => {
  it("new jobs can be shortlisted; shortlisted ones lead to Apply", async () => {
    const api = mockApi({
      "GET /jobs": page([JOB, { ...JOB, id: 8, title: "PHP Lead", status: "SHORTLISTED" }]),
      "POST /jobs/7/status": { ok: true },
    });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Shortlist Magento Lead" }));
    expect(api.calls.find((c) => c.method === "POST")).toMatchObject({ path: "/jobs/7/status", body: { status: "SHORTLISTED" } });
    expect(screen.getByRole("link", { name: "Apply to PHP Lead" })).toHaveAttribute("href", "/jobs/8?apply=1");
  });
});

describe("job comments", () => {
  const COMMENTS = [{ id: 3, body: "Called the recruiter", created_at: "2026-10-11T09:30:00Z" }];

  it("adds a comment and shows existing ones with their date", async () => {
    const api = mockApi({ "POST /jobs/7/comments": { id: 4, body: "Follow up Monday", created_at: "2026-10-11T10:00:00Z" } });
    renderAt(<JobComments jobId={7} comments={COMMENTS} />, { path: "/jobs/:id", route: "/jobs/7" });
    expect(screen.getByText("Called the recruiter")).toBeInTheDocument();
    expect(screen.getByText(/(11 Oct|Oct 11)/)).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add comment" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("New comment"), "  Follow up Monday ");
    await userEvent.click(add);
    expect(api.calls.find((c) => c.method === "POST")).toMatchObject({ path: "/jobs/7/comments", body: { body: "Follow up Monday" } });
    expect(screen.getByLabelText("New comment")).toHaveValue("");
  });

  it("asks before deleting a comment", async () => {
    const api = mockApi({ "DELETE /jobs/7/comments/3": () => new Response(null, { status: 204 }) });
    renderAt(<JobComments jobId={7} comments={COMMENTS} />, { path: "/jobs/:id", route: "/jobs/7" });
    await userEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    expect(api.calls).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /jobs/7/comments/3"]);
  });
});
