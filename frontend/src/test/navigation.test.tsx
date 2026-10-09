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

const SUMMARY = { total_jobs: 410, closed_jobs: 6, new_jobs: 410, jobs_scored: 416, jobs_90_plus: 1, jobs_80_plus: 39, stale_scores: 0,
  shortlisted: 2, applications: 1, interviews: 3, offers: 0, rejections: 4, pending_followups: 5, overdue_followups: 0, companies: 722 };

describe("dashboard cards", () => {
  it("each card links to its filtered results", async () => {
    mockApi({ "GET /dashboard": { summary: SUMMARY, priorities: [], funnels: {} }, "GET /dashboard/charts": {} });
    renderAt(<DashboardPage />);
    const link = async (label: string) => (await screen.findByRole("link", { name: `${label}: view results` })).getAttribute("href");
    expect(await link("Open jobs")).toBe("/jobs");
    expect(await link("Closed positions")).toBe("/jobs/closed");
    expect(await link("New to review")).toBe("/jobs?tab=new");
    expect(await link("Excellent fit (90+)")).toBe("/jobs?min_score=90");
    expect(await link("Strong fit (80+)")).toBe("/jobs?min_score=80");
    expect(await link("Shortlisted")).toBe("/jobs?tab=pending&status=SHORTLISTED");
    expect(await link("Applications")).toBe("/applications");
    expect(await link("Interviews")).toBe("/interviews?upcoming=false");
    expect(await link("Rejections")).toBe("/applications?status=REJECTED");
    expect(await link("Follow-ups to do")).toBe("/followups");
    expect(await link("Applied this week")).toBe("/applications");
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
    expect(await tab(/All open\s*417/)).toHaveAttribute("href", "/jobs?q=magento");
    expect(await tab(/^New\s*400/)).toHaveAttribute("href", "/jobs?tab=new&q=magento");
    expect(await tab(/Pending\s*2/)).toHaveAttribute("href", "/jobs?tab=pending&q=magento");
    expect(await tab(/Applied\s*4/)).toBeInTheDocument();
    expect(await tab(/Interview\s*1/)).toBeInTheDocument();
    expect(await tab(/Selected\s*1/)).toBeInTheDocument();
    expect(await tab(/Rejected\s*4/)).toBeInTheDocument();
    expect(await tab(/Not pursuing\s*5/)).toBeInTheDocument();
    expect(await tab(/Closed\s*9/)).toHaveAttribute("aria-selected", "true");
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
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    const box = screen.getByRole("listbox", { name: "Job statuses" });
    expect(box).not.toHaveTextContent("Interview");
    await userEvent.click(within(box).getByLabelText("Screening"));
    expect(listRequest(api.fn, true).searchParams.getAll("status")).toEqual(["SCREENING"]);
  });

  it("all-open tab hides closed positions", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByText("No jobs match these filters.")).toBeInTheDocument();
    expect(listRequest(api.fn).searchParams.get("closed")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getByRole("listbox", { name: "Job statuses" })).not.toHaveTextContent("Closed");
  });
});
