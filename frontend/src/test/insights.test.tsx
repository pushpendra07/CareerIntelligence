import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsPage } from "../features/analytics/AnalyticsPage";
import { FetchDescriptions } from "../features/jobs/FetchDescriptions";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

describe("insights", () => {
  it("states what the numbers mean", async () => {
    mockApi({
      "GET /dashboard/analytics": {
        scores: { average_component_factor: { skills: 0.4, role: 0.9 }, by_recommendation: [], average_score: "71",
          average_score_applied: "65", interview_rate_by_score: [{ label: "80+", applications: 4, interviews: 2 }] },
        skill_gaps: [{ label: "Python", value: 12, avg_job_score: 60 }], top_requested_skills: [],
      },
      "GET /dashboard/funnels": { application: [{ stage: "Applied", value: 10 }, { stage: "Interview", value: 2 }] },
      "GET /dashboard/charts": { jobs_by_score: [], source_quality: [
        { label: "INDEED", value: 5, avg_score: 62, strong: 0, applied: 1 },
        { label: "GREENHOUSE", value: 8, avg_score: 81.5, strong: 5, applied: 2 },
      ] },
      "GET /dashboard": { summary: { applications: 10, responses: 4, interviews: 2, offers: 0 } },
    });
    renderAt(<AnalyticsPage />, { path: "/analytics", route: "/analytics" });
    expect(await screen.findByText(/4 of 10 applications got an answer \(40%\)/)).toBeInTheDocument();
    const sources = screen.getByRole("region", { name: "Where good jobs come from" });
    expect(await within(sources).findByText("Greenhouse", { selector: "b" })).toBeInTheDocument();
    expect(within(sources).getByRole("link", { name: "Indeed" })).toHaveAttribute("href", "/jobs?source=INDEED");
    expect(within(sources).getByRole("link", { name: "Greenhouse" })).toBeInTheDocument();
    expect(screen.getByText(/You're applying below your average fit/)).toBeInTheDocument();
    expect(screen.getByText("Skills", { selector: "b" })).toBeInTheDocument(); // weakest component
    expect(screen.getByText("Python", { selector: "b" })).toBeInTheDocument();
  });
});

describe("insights: answers by score, companies, activity", () => {
  it("compares answer rates above and below 80, links companies, hides unknown work models", async () => {
    mockApi({
      "GET /dashboard/analytics": {
        scores: { average_component_factor: {}, by_recommendation: [], average_score: null, average_score_applied: null,
          interview_rate_by_score: [
            { label: "80-89", applications: 10, answers: 3, interviews: 1 },
            { label: "60-69", applications: 20, answers: 1, interviews: 0 },
          ] },
        skill_gaps: [], top_requested_skills: [],
      },
      "GET /dashboard/funnels": { application: [{ stage: "Applied", value: 30 }] },
      "GET /dashboard/charts": {
        jobs_by_score: [], source_quality: [],
        top_companies: [{ id: 9, label: "Acme", value: 3, jobs: 5, avg_score: 84, tier: "TIER_A" }],
        jobs_by_work_model: [{ label: "REMOTE", value: 4 }, { label: "UNKNOWN", value: 7 }],
      },
      "GET /dashboard": { summary: { applications: 30, responses: 2, interviews: 1, offers: 0, due_followups: 4,
        applied_this_week: 6, applied_last_week: 9, unapplied_70_plus: 12 } },
      "GET /reports/overview": { charts: [
        { id: "jobs", data: [{ label: "13 Oct", value: 5 }, { label: "20 Oct", value: 8 }] },
        { id: "activity", data: [{ label: "13 Oct", Applications: 2 }, { label: "20 Oct", Applications: 4 }] },
      ] },
    });
    renderAt(<AnalyticsPage />, { path: "/analytics", route: "/analytics" });
    expect(await screen.findByText(/Jobs scored 80\+ got an answer 30% of the time \(3 of 10\); below 80, 5% \(1 of 20\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "4 follow-ups are due" })).toHaveAttribute("href", "/followups");
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/companies/9");
    expect(screen.getByText("3 of 5 · avg 84")).toBeInTheDocument();
    expect(screen.getByText("7 jobs don't say.")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Applied this week: view results" })).toHaveTextContent("6▼ 3 vs last week");
    expect(screen.getByRole("link", { name: "Good jobs not applied (70+): view results" })).toHaveAttribute("href", "/jobs?min_score=70&has_application=false");
    expect(await screen.findByText("Last 12 weeks: jobs found and applications sent")).toBeInTheDocument();
  });
});

describe("fetch missing descriptions", () => {
  it("starts a run and shows its progress, then the result", async () => {
    let state: unknown = { missing: 30, missing_70_plus: 6, running: null, last_run: null };
    const api = mockApi({
      "GET /jobs/fetch-descriptions": () => state,
      "POST /jobs/fetch-descriptions": () => {
        state = { missing: 30, missing_70_plus: 6, last_run: null,
          running: { id: 1, status: "RUNNING", started_at: "", finished_at: null, stats: { total: 30, checked: 12, fetched: 7 } } };
        return { id: 1, status: "RUNNING" };
      },
    });
    renderAt(<FetchDescriptions />);
    await userEvent.click(await screen.findByRole("button", { name: "Fetch for 30 best jobs" }));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ limit: 40 });
    expect(await screen.findByText(/Reading descriptions… 12 of 30 · 7 found/)).toBeInTheDocument();
  });

  it("explains what the last run found", async () => {
    mockApi({ "GET /jobs/fetch-descriptions": { missing: 3, missing_70_plus: 1, running: null,
      last_run: { id: 2, status: "COMPLETED", started_at: "", finished_at: "", stats: { total: 40, fetched: 18, not_allowed: 10, failed: 12 } } } });
    renderAt(<FetchDescriptions />);
    expect(await screen.findByText(/18 of 40 found · 10 on sites that don't allow it \(open and paste\) · 12 pages had none/)).toBeInTheDocument();
  });
});
