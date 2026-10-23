import { useLocation } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { BackButton } from "../components/ui";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { JobsPage } from "../features/jobs/JobsPage";
import { ApplicationsPage } from "../features/applications/ApplicationsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

/** The jobs list request (the tab counts also call /jobs, with size=1). */
function listRequest(fn: { mock: { calls: unknown[][] } }, last = false): URL {
  const urls = fn.mock.calls.map((c) => new URL(String(c[0]), "http://x"))
    .filter((u) => u.pathname.endsWith("/jobs") && u.searchParams.get("size") !== "1");
  return last ? urls[urls.length - 1] : urls[0];
}

function Where() {
  const { search } = useLocation();
  return <p data-testid="where">{search}</p>;
}

const SUMMARY = { total_jobs: 410, closed_jobs: 6, new_jobs: 410, jobs_scored: 416, jobs_90_plus: 1, jobs_80_plus: 39, stale_scores: 0,
  shortlisted: 2, applications: 1, interviews: 3, offers: 0, rejections: 4, pending_followups: 5, overdue_followups: 0, companies: 722 };

describe("dashboard cards", () => {
  it("each card links to its filtered results", async () => {
    mockApi({ "GET /dashboard": { summary: { ...SUMMARY, new_70_plus: 4, ready_to_apply: 2, due_followups: 1,
      upcoming_interviews: 1, missing_jd_70_plus: 6, responses: 1 }, priorities: [], funnels: {} },
    "GET /jobs/fetch-descriptions": { missing: 20, missing_70_plus: 6, running: null, last_run: null } });
    renderAt(<DashboardPage />);
    const action = async (label: string) => (await screen.findByRole("link", { name: `${label}: open` })).getAttribute("href");
    expect(await action("New jobs to review")).toBe("/jobs/review?min_score=70");
    expect(await action("Ready to apply")).toBe("/jobs?tab=pending");
    expect(await action("Follow-ups due")).toBe("/followups");
    expect(await action("Interviews coming up")).toBe("/interviews");
    expect(await action("Good jobs without a description")).toBe("/jobs?min_score=70&sort=-match_score");
    const link = async (label: string) => (await screen.findByRole("link", { name: `${label}: view results` })).getAttribute("href");
    expect(await link("Applied this week")).toBe("/applications");
    expect(await link("New jobs this week")).toBe("/jobs?sort=-created_at");
    expect(await link("Good jobs not applied (70+)")).toBe("/jobs?min_score=70&has_application=false");
    expect(await link("Interviews")).toBe("/interviews?upcoming=false");
    expect(await link("Response rate")).toBe("/analytics");
    expect(screen.getByRole("link", { name: "Response rate: view results" })).toHaveTextContent("100%of 1 applications"); // 1 of 1
    expect(await screen.findByRole("button", { name: "Fetch for 20 best jobs" })).toBeInTheDocument();
  });

  it("jobs page sends every status from the card link", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?status=NEW&status=DISCOVERED" });
    expect(await screen.findByText("No jobs match these filters.")).toBeInTheDocument();
    expect(listRequest(api.fn).searchParams.getAll("status")).toEqual(["NEW", "DISCOVERED"]);
  });

  it("applications page starts with the status from the link", async () => {
    const api = mockApi({ "GET /applications": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<ApplicationsPage />, { path: "/applications", route: "/applications?status=REJECTED" });
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
    expect(String(api.fn.mock.calls[0][0])).toContain("status=REJECTED");
    expect(screen.getByLabelText("Application status")).toHaveValue("REJECTED");
  });
});

describe("back button", () => {
  it("goes back in history, or to the fallback when opened directly", async () => {
    const user = userEvent.setup();
    const routes = [
      { path: "/companies", element: <p>Company list</p> },
      { path: "/companies/:id", element: <BackButton fallback="/companies" label="Back to companies" /> },
      { path: "/jobs", element: <p>Job list</p> },
    ];
    const direct = createMemoryRouter(routes, { initialEntries: ["/companies/5"] });
    const { unmount } = render(<RouterProvider router={direct} />);
    await user.click(screen.getByRole("button", { name: "← Back to companies" }));
    expect(await screen.findByText("Company list")).toBeInTheDocument();
    unmount();

    const fromJobs = createMemoryRouter(routes, { initialEntries: ["/jobs"] });
    render(<RouterProvider router={fromJobs} />);
    await fromJobs.navigate("/companies/5");
    await user.click(await screen.findByRole("button", { name: "← Back to companies" }));
    expect(await screen.findByText("Job list")).toBeInTheDocument();
  });
});

describe("job status tabs", () => {
  const JOB = { id: 1, title: "Magento Lead", status: "CLOSED", match_score: 80, score_stale: false, jd_status: "OK",
    company: { id: 1, name: "Acme", tier: null }, location: null, work_model: "UNKNOWN", experience_min: null,
    experience_max: null, salary_min: null, salary_max: null, salary_currency: null, sources: ["LINKEDIN"], posting_date: null };
  const COUNTS = { NEW: 100, DISCOVERED: 300, SHORTLISTED: 2, APPLIED: 3, SCREENING: 1, INTERVIEW: 1, OFFER: 1,
    REJECTED: 4, NOT_RELEVANT: 5, CLOSED: 9 };

  it("shows every status tab with counts; closed tab lists closed positions", async () => {
    const api = mockApi({ "GET /jobs": { items: [JOB], total: 1, page: 1, size: 50 }, "GET /jobs/status-counts": COUNTS });
    renderAt(<JobsPage view="closed" />, { path: "/jobs/closed", route: "/jobs/closed?q=magento&status=NEW" });
    expect(await screen.findByRole("heading", { name: "Closed positions" })).toBeInTheDocument();
    const list = listRequest(api.fn);
    expect(list.searchParams.get("closed")).toBe("true");
    expect(list.searchParams.getAll("status")).toEqual(["CLOSED"]);
    const tab = async (name: RegExp) => screen.findByRole("tab", { name });
    expect(await tab(/All open\s*400/)).toHaveAttribute("href", "/jobs?tab=all&q=magento"); // New + Discovered
    expect(await tab(/^All\s*417/)).toHaveAttribute("href", "/jobs?tab=every&q=magento"); // all but closed
    expect(screen.queryByRole("tab", { name: /^New/ })).not.toBeInTheDocument();
    expect(await tab(/Pending\s*2/)).toHaveAttribute("href", "/jobs?tab=pending&q=magento");
    expect(await tab(/Applied\s*4/)).toBeInTheDocument();
    expect(await tab(/Interview\s*1/)).toBeInTheDocument();
    expect(await tab(/Selected\s*1/)).toBeInTheDocument();
    expect(await tab(/Rejected\s*4/)).toBeInTheDocument();
    expect(await tab(/Not pursuing\s*5/)).toBeInTheDocument();
    expect(await tab(/Closed\s*9/)).toHaveAttribute("aria-selected", "true");
    const bar = screen.getByRole("tablist", { name: "Job status" }); // grouped by stage
    for (const g of ["Everything", "To review", "In progress", "Finished"]) expect(bar).toHaveTextContent(g);
    const label = await screen.findByText("Closed", { selector: "span" });
    expect(label.className).toContain("bg-zinc-200");
    expect(screen.queryByRole("button", { name: "Status" })).not.toBeInTheDocument(); // one status only
  });

  it("applied tab lists its statuses and the filter narrows inside it", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 }, "GET /jobs/status-counts": COUNTS });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=applied" });
    expect(await screen.findByRole("heading", { name: "Applied jobs" })).toBeInTheDocument();
    expect(await screen.findByText("No applied jobs match these filters.")).toBeInTheDocument();
    expect(listRequest(api.fn).searchParams.getAll("status")).toEqual(["APPLIED", "RECRUITER_CONTACTED", "SCREENING"]);
    // One chip per status in the tab, with counts; picking one narrows the list to it.
    const chips = screen.getByRole("group", { name: "Status" });
    expect(await within(chips).findByRole("button", { name: /^All\s*4$/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(chips).getByRole("button", { name: /^Recruiter Contacted\s*0$/ })).toBeInTheDocument();
    expect(chips).not.toHaveTextContent("Interview");
    await userEvent.click(within(chips).getByRole("button", { name: /^Screening\s*1$/ }));
    expect(listRequest(api.fn, true).searchParams.getAll("status")).toEqual(["SCREENING"]);
    expect(within(chips).getByRole("button", { name: /^Screening/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("searching or filtering stays in the tab you're on", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 }, "GET /jobs/status-counts": {} });
    renderAt(<><JobsPage /><Where /></>, { path: "/jobs", route: "/jobs" }); // plain /jobs = All open
    expect(await screen.findByRole("heading", { name: "All open jobs" })).toBeInTheDocument();
    const search = screen.getByLabelText("Search jobs");
    await userEvent.type(search, "magento{Enter}");
    expect(await screen.findByRole("heading", { name: "All open jobs" })).toBeInTheDocument(); // not All
    const last = listRequest(api.fn, true);
    expect(last.searchParams.get("q")).toBe("magento");
    expect(last.searchParams.getAll("status")).toEqual(["NEW", "DISCOVERED"]);
    expect(screen.getByTestId("where")).toHaveTextContent("tab=all");

    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=pending" });
    await userEvent.click((await screen.findAllByRole("button", { name: /^Filters/ })).at(-1)!);
    await userEvent.type(screen.getAllByLabelText("Skills").at(-1)!, "PHP{Enter}");
    const pending = listRequest(api.fn, true);
    expect(pending.searchParams.get("technology")).toBe("PHP");
    expect(pending.searchParams.getAll("status")).toEqual(["REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "ON_HOLD"]);
  });

  it("opens on All open: jobs as imported, no status set since, newest first", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=new" }); // old links still work
    expect(await screen.findByRole("heading", { name: "All open jobs" })).toBeInTheDocument();
    expect(listRequest(api.fn).searchParams.getAll("status")).toEqual(["NEW", "DISCOVERED"]);
    expect(listRequest(api.fn).searchParams.get("sort")).toBe("-created_at");
  });

  it("links with filters search every job", async () => {
    mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?min_score=70" });
    expect(await screen.findByRole("heading", { name: "All jobs" })).toBeInTheDocument();
  });

  it("all-open tab lists only jobs as imported; the All tab lists every status but closed", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=all" });
    expect(await screen.findByRole("heading", { name: "All open jobs" })).toBeInTheDocument();
    expect(listRequest(api.fn).searchParams.getAll("status")).toEqual(["NEW", "DISCOVERED"]);

    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=every" });
    expect(await screen.findByText("No jobs match these filters.")).toBeInTheDocument();
    expect(listRequest(api.fn, true).searchParams.get("closed")).toBe("false");
    const sent = listRequest(api.fn, true).searchParams.getAll("status");
    for (const s of ["NEW", "SHORTLISTED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED", "NOT_RELEVANT"]) expect(sent).toContain(s);
    expect(sent).not.toContain("CLOSED");
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("Any status");
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    const box = screen.getByRole("listbox", { name: "Job statuses" });
    expect(box).not.toHaveTextContent("Closed");
    await userEvent.click(within(box).getByLabelText("Applied"));
    expect(listRequest(api.fn, true).searchParams.getAll("status")).toEqual(["APPLIED"]);
  });
});
