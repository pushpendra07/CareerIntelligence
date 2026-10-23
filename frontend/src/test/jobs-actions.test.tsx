import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobComments } from "../features/jobs/JobComments";
import { JobsPage } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 7, title: "Magento Lead", status: "NEW", match_score: 80, score_stale: false, jd_status: "OK", created_at: "2026-10-12T08:00:00Z",
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
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=every" });
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
    expect(cleared).not.toContain("CLOSED"); // closed: its own tab
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("Any status");
  }, 15_000); // clicks through every status
});

describe("delete job", () => {
  it("asks first, then deletes", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]), "DELETE /jobs/7": { deleted: 7 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "More actions for Magento Lead" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Magento Lead" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "More actions for Magento Lead" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Magento Lead" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/This job has 1 application\. Deleting it deletes those too\. Delete anyway\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    const urls = api.fn.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/jobs/7"));
    expect(urls.at(-1)).toContain("force=true");
  });
});

describe("sorting and page size", () => {
  it("sorts by clicking column headers and shows 25 per page by default", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await screen.findByText("Magento Lead");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("size")).toBe("25");

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
    expect(await screen.findByTitle("Added via Job board search")).toHaveTextContent("Job board search");
    expect(screen.getByTitle("Added via Google Sheet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Added via" }), "career_ops");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("added_via")).toBe("career_ops");
  });
});

describe("job id", () => {
  it("shows the job ID and sorts by it", async () => {
    const api = mockApi({ "GET /jobs": page([JOB]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByTitle("Job ID")).toHaveTextContent("#7");
    await userEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("-id"); // newest ID first
    await userEvent.click(screen.getByRole("button", { name: "Sort by added" }));
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("-created_at");
    expect(screen.getByRole("columnheader", { name: /Added/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /Posted/ })).toBeInTheDocument();
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
    expect(listUrls(api.fn).at(-1)!.searchParams.get("sort")).toBe("-created_at"); // newest first
    await userEvent.click(screen.getByRole("button", { name: "Sort by posted" }));
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
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
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent("Filters2"); // how many are on
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(within(screen.getByRole("group", { name: "Score" })).getByRole("button", { name: "70+" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    last = listUrls(api.fn).at(-1)!;
    expect(last.searchParams.get("sort")).toBe("-created_at");
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
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
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

describe("live list", () => {
  it("shows a status change without a page reload", async () => {
    let status = "NEW";
    mockApi({
      "GET /jobs": (url: URL) => page([{ ...JOB, status }])(url),
      "POST /jobs/7/status": () => { status = "SHORTLISTED"; return { ...JOB, status }; },
    });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("button", { name: "Shortlist Magento Lead" }));
    expect(await screen.findByRole("link", { name: "Apply to Magento Lead" })).toBeInTheDocument();
  });
});

describe("bulk actions", () => {
  const two = [JOB, { ...JOB, id: 8, title: "PHP Architect" }];

  it("ticks jobs and changes their status together", async () => {
    const api = mockApi({ "GET /jobs": page(two), "POST /jobs/bulk": { updated: 2, missing: [] } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(screen.queryByRole("region", { name: "Selected jobs" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all jobs on this page" }));
    const bar = screen.getByRole("region", { name: "Selected jobs" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Not relevant" }));
    expect(api.calls.find((c) => c.path === "/jobs/bulk")?.body).toEqual({ job_ids: [7, 8], action: "status", status: "NOT_RELEVANT" });
    expect(await screen.findByText("Updated 2 jobs.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected jobs" })).not.toBeInTheDocument();
  });

  it("deletes after confirming, and says which tracked jobs were kept", async () => {
    const api = mockApi({ "GET /jobs": page(two), "POST /jobs/bulk": { deleted: 1, skipped: [{ id: 8, title: "PHP Architect", reason: "x" }], missing: [] } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Magento Lead" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select PHP Architect" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(api.calls.some((c) => c.path === "/jobs/bulk")).toBe(false); // asks first
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.calls.find((c) => c.path === "/jobs/bulk")?.body).toEqual({ job_ids: [7, 8], action: "delete" });
    expect(await screen.findByText(/Deleted 1 job\. Kept 1 with an application/)).toBeInTheDocument();
  });
});

describe("ticked jobs", () => {
  it("stay ticked when a filter box loses focus without a change (clicking a blank area)", async () => {
    // 60 jobs, so page 2 exists.
    const items = [JOB, { ...JOB, id: 8, title: "PHP Lead" }];
    const api = mockApi({ "GET /jobs": (url: URL) => (url.searchParams.get("size") === "1"
      ? { items: [], total: 60, page: 1, size: 1 } : { items, total: 60, page: 2, size: 25 }), "GET /jobs/status-counts": {} });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?page=2" });
    await screen.findByLabelText("Select Magento Lead");
    await vi.waitFor(() => expect(api.fn.mock.calls.length).toBeGreaterThan(1)); // list and counts loaded
    await new Promise((r) => setTimeout(r, 50));
    await userEvent.click(screen.getByLabelText("Select Magento Lead"));
    await userEvent.click(screen.getByLabelText("Select PHP Lead"));
    expect(screen.getByRole("region", { name: "Selected jobs" })).toHaveTextContent("2 selected");
await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(screen.getByRole("region", { name: "Selected jobs" })).toHaveTextContent("2 selected");
    const calls = listUrls(api.fn).length;
    for (const name of ["Location", "Skills", "Experience fits"]) {
      await userEvent.click(screen.getByLabelText(name));
      await userEvent.click(document.body); // blank area
    }
    expect(screen.getByRole("region", { name: "Selected jobs" })).toHaveTextContent("2 selected");
    expect(listUrls(api.fn).length).toBe(calls); // nothing reloaded
    expect(listUrls(api.fn).at(-1)!.searchParams.get("page")).toBe("2"); // still page 2

    await userEvent.type(screen.getByLabelText("Location"), "Pune");
    await userEvent.click(document.body);
    expect(listUrls(api.fn).at(-1)!.searchParams.get("location")).toBe("Pune"); // a real change still filters

    await userEvent.type(screen.getByLabelText("Skills"), "GraphQL{Enter}");
    expect(listUrls(api.fn).at(-1)!.searchParams.get("technology")).toBe("GraphQL"); // Enter applies it
  });
});
