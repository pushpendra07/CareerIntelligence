import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, qs, ApiError } from "../api/client";
import { BarChart, Funnel } from "../components/charts";
import { ListInput } from "../components/ListInput";
import { DashboardPage, TodaysPriorities } from "../features/dashboard/DashboardPage";
import { AddJobPage, jobSchema, toPayload } from "../features/jobs/AddJobPage";
import { JobsPage } from "../features/jobs/JobsPage";
import { experienceRange, formatMoney, humanize, salaryRange } from "../utils/format";
import { mockApi, renderAt } from "./utils";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";

afterEach(() => vi.unstubAllGlobals());

describe("formatting", () => {
  it("formats INR in lakhs and ranges", () => {
    expect(formatMoney("3500000", "INR")).toBe("₹35 L");
    expect(formatMoney("2550000", "INR")).toBe("₹25.5 L");
    expect(salaryRange(null, null, null)).toBe("Not disclosed");
    expect(salaryRange("3000000", "4000000", "INR")).toBe("₹30 L – ₹40 L");
    expect(experienceRange("10.0", null)).toBe("10+ yrs");
    expect(experienceRange("5", "8")).toBe("5–8 yrs");
    expect(humanize("HIGHLY_RECOMMENDED")).toBe("Highly Recommended");
  });

  it("builds query strings, skipping empties and repeating arrays", () => {
    expect(qs({ a: 1, b: "", c: undefined, s: ["X", "Y"] })).toBe("?a=1&s=X&s=Y");
  });

  it("shows the first field error from a 422", () => {
    const err = new ApiError(422, "validation_error", "Request validation failed",
      [{ loc: ["body", "url"], msg: "must be an http(s) URL" }]);
    expect(errorMessage(err)).toBe("url: must be an http(s) URL");
  });
});

describe("add job form", () => {
  it("validates required fields and URLs", () => {
    const base = { title: "", company: "", url: "", source: "", location: "", work_model: "", employment_type: "",
      experience: "", salary: "", salary_currency: "", posting_date: "", application_deadline: "",
      recruiter_name: "", recruiter_linkedin: "", recruiter_email: "", jd: "", responsibilities: "",
      required_skills: "", preferred_skills: "", qualifications: "", notes: "" };
    const bad = jobSchema.safeParse({ ...base, url: "not a url", recruiter_email: "nope" });
    expect(bad.success).toBe(false);
    const fields = bad.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["title", "company", "jd", "url", "recruiter_email"]));
    const ok = jobSchema.parse({ ...base, title: "Tech Lead", company: "Acme", jd: "PHP", required_skills: "PHP, Magento 2" });
    expect(toPayload(ok)).toEqual({ title: "Tech Lead", company: "Acme", jd: "PHP", required_skills: ["PHP", "Magento 2"] });
  });

  it("shows the live preview and submits the job", async () => {
    const api = mockApi({
      "POST /jobs/preview": { source: "NAUKRI", external_id: "123456789012", is_aggregator: true, parsed: {
        required_skills: ["PHP", "Magento 2"], preferred_skills: ["AWS"], experience_min: 10, experience_max: null,
        salary_min: "3000000", salary_max: "4000000", salary_currency: "INR", locations: ["Pune"], work_model: "HYBRID",
        employment_type: null, seniority: "LEAD", constraints: [] } },
      "POST /jobs": { job: { id: 42 }, created: true, duplicate_matched_by: null },
    });
    const user = userEvent.setup();
    renderAt(<AddJobPage />, { path: "/jobs/new", route: "/jobs/new" });
    await user.type(screen.getByLabelText("Job Title *"), "Tech Lead");
    await user.type(screen.getByLabelText("Company *"), "Acme");
    await user.type(screen.getByLabelText("Job Description *"), "Strong PHP and Magento 2");
    expect(await screen.findByText("aggregator — confirm at employer", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("₹30 L – ₹40 L", { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save & analyze/i }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/jobs")).toBe(true));
    const sent = api.calls.find((c) => c.path === "/jobs")!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ title: "Tech Lead", company: "Acme", jd: "Strong PHP and Magento 2" });
  });

  it("blocks submission when required fields are missing", async () => {
    const api = mockApi({});
    const user = userEvent.setup();
    renderAt(<AddJobPage />, { path: "/jobs/new", route: "/jobs/new" });
    await user.click(screen.getByRole("button", { name: /save & analyze/i }));
    expect(await screen.findByText("Job title is required")).toBeInTheDocument();
    expect(screen.getByText("Paste the job description")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === "/jobs")).toHaveLength(0);
  });
});

describe("dashboard", () => {
  it("renders summary, priorities and funnels", async () => {
    mockApi({
      "GET /dashboard": {
        summary: { total_jobs: 78, new_jobs: 73, jobs_scored: 78, jobs_90_plus: 1, jobs_80_plus: 3, stale_scores: 2,
          shortlisted: 0, applications: 1, interviews: 0, offers: 0, rejections: 0, pending_followups: 1,
          overdue_followups: 0, companies: 541 },
        priorities: [{ position: 1, type: "APPLY", title: "Apply — Technical Lead — 93/100", detail: "Codilar", due: null, link: { entity: "job", id: 5 } }],
        funnels: { application: [{ stage: "Applied", value: 1 }, { stage: "Interview", value: 0 }] },
      },
      "GET /dashboard/charts": { jobs_by_score: [{ label: "90-100", value: 1 }] },
    });
    renderAt(<DashboardPage />);
    expect(await screen.findByText("Apply — Technical Lead — 93/100")).toHaveAttribute("href", "/jobs/5");
    expect(screen.getByText("541")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-analyze 2 stale" })).toBeInTheDocument();
  });

  it("explains an empty priority list", () => {
    render(<MemoryRouter><TodaysPriorities items={[]} /></MemoryRouter>);
    expect(screen.getByText(/Nothing urgent today/)).toBeInTheDocument();
  });
});

describe("jobs list", () => {
  it("passes URL filters to the API and renders rows", async () => {
    const api = mockApi({
      "GET /jobs": { total: 1, page: 1, size: 50, items: [{
        id: 7, title: "Adobe Commerce Technical Lead", company: { id: 1, name: "Bosch Group", tier: null, verification_status: "DISCOVERED", website: null, careers_url: null },
        source: "CAREER_OPS", sources: ["CAREER_OPS"], location: "Bengaluru", locations: ["Bengaluru"], work_model: "HYBRID",
        experience_min: "8", experience_max: "10", salary_min: null, salary_max: null, salary_currency: null, posting_date: "2026-09-01",
        status: "DISCOVERED", match_score: 79, score_stale: true, jd_status: "OK" }] },
    });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?technology=PHP&min_score=70" });
    expect(await screen.findByText("Adobe Commerce Technical Lead")).toBeInTheDocument();
    expect(screen.getByText("stale")).toBeInTheDocument();
    const call = api.fn.mock.calls[0][0] as string;
    expect(call).toContain("technology=PHP");
    expect(call).toContain("min_score=70");
  });
});

describe("components", () => {
  it("bar chart and funnel handle data and empty states", () => {
    const { rerender } = render(<BarChart data={[]} empty="Nothing" />);
    expect(screen.getByText("Nothing")).toBeInTheDocument();
    rerender(<BarChart data={[{ label: "PHP", value: 5 }]} />);
    expect(screen.getByText("PHP")).toBeInTheDocument();
    rerender(<Funnel stages={[{ stage: "Applied", value: 10 }, { stage: "Interview", value: 4 }]} />);
    expect(screen.getByText("· 40%", { exact: false })).toBeInTheDocument();
  });

  it("list input adds, dedupes and removes items", async () => {
    function Harness() {
      const [v, setV] = useState<string[]>(["PHP"]);
      return <><ListInput label="skills" value={v} onChange={setV} /><output>{v.join("|")}</output></>;
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("skills"), "Magento 2{Enter}php{Enter}");
    expect(screen.getByText("PHP|Magento 2", { selector: "output" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Remove PHP"));
    expect(screen.getByText("Magento 2", { selector: "output" })).toBeInTheDocument();
  });
});
