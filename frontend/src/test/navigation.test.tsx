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

const SUMMARY = { total_jobs: 416, new_jobs: 410, jobs_scored: 416, jobs_90_plus: 1, jobs_80_plus: 39, stale_scores: 0,
  shortlisted: 2, applications: 1, interviews: 3, offers: 0, rejections: 4, pending_followups: 5, overdue_followups: 0, companies: 722 };

describe("dashboard cards", () => {
  it("each card links to its filtered results", async () => {
    mockApi({ "GET /dashboard": { summary: SUMMARY, priorities: [], funnels: {} }, "GET /dashboard/charts": {} });
    renderAt(<DashboardPage />);
    const link = async (label: string) => (await screen.findByRole("link", { name: `${label}: view results` })).getAttribute("href");
    expect(await link("Total jobs")).toBe("/jobs");
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
    const url = new URL(String(api.fn.mock.calls[0][0]), "http://x");
    expect(url.searchParams.getAll("status")).toEqual(["NEW", "DISCOVERED"]);
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
