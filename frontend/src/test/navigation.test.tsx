import { render, screen } from "@testing-library/react";
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
function listRequest(fn: { mock: { calls: unknown[][] } }): URL {
  const urls = fn.mock.calls.map((c) => new URL(String(c[0]), "http://x"));
  return urls.find((u) => u.pathname.endsWith("/jobs") && u.searchParams.get("size") !== "1")!;
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
    expect(await link("New jobs")).toBe("/jobs?status=NEW&status=DISCOVERED");
    expect(await link("Jobs ≥ 90")).toBe("/jobs?min_score=90");
    expect(await link("Jobs ≥ 80")).toBe("/jobs?min_score=80");
    expect(await link("Shortlisted")).toBe("/jobs?status=SHORTLISTED");
    expect(await link("Applications")).toBe("/applications");
    expect(await link("Interviews")).toBe("/interviews?upcoming=false");
    expect(await link("Rejections")).toBe("/applications?status=REJECTED");
    expect(await link("Pending follow-ups")).toBe("/followups");
    expect(await link("Companies")).toBe("/companies");
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

describe("open and closed job tabs", () => {
  const JOB = { id: 1, title: "Magento Lead", status: "CLOSED", match_score: 80, score_stale: false, jd_status: "OK",
    company: { id: 1, name: "Acme", tier: null }, location: null, work_model: "UNKNOWN", experience_min: null,
    experience_max: null, salary_min: null, salary_max: null, salary_currency: null, sources: ["LINKEDIN"], posting_date: null };

  it("closed tab lists only closed positions, with counts and colored status labels", async () => {
    const api = mockApi({
      "GET /jobs": (url: URL) => url.searchParams.get("size") === "1"
        ? { items: [], total: url.searchParams.get("closed") === "true" ? 4 : 412, page: 1, size: 1 }
        : { items: [JOB], total: 1, page: 1, size: 50 },
    });
    renderAt(<JobsPage view="closed" />, { path: "/jobs/closed", route: "/jobs/closed?q=magento&status=NEW" });
    expect(await screen.findByRole("heading", { name: "Closed positions" })).toBeInTheDocument();
    const listUrl = listRequest(api.fn);
    expect(listUrl.searchParams.get("closed")).toBe("true");
    expect(listUrl.searchParams.getAll("status")).toEqual([]); // status filter doesn't apply here
    const openTab = await screen.findByRole("tab", { name: /Open jobs\s*412/ });
    expect(openTab).toHaveAttribute("href", "/jobs?q=magento");
    expect(await screen.findByRole("tab", { name: /Closed positions\s*4/ })).toHaveAttribute("aria-selected", "true");
    const label = await screen.findByText("Closed");
    expect(label.closest("span")?.className).toContain("bg-zinc-200");
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });

  it("open tab hides closed positions", async () => {
    const api = mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 50 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByText("No jobs match these filters.")).toBeInTheDocument();
    expect(listRequest(api.fn).searchParams.get("closed")).toBe("false");
    const options = [...(screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement).options].map((o) => o.value);
    expect(options).not.toContain("CLOSED");
  });
});
