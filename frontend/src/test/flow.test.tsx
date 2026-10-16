import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowupsPage } from "../features/followups/FollowupsPage";
import { inDays, dueLabel } from "../features/followups/FollowUpParts";
import { JobDetailPage } from "../features/jobs/JobDetailPage";
import { AppLayout, locate } from "../layouts/AppLayout";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

describe("menu", () => {
  it("has one entry per area, with counts, and tabs for related pages", async () => {
    mockApi({ "GET /dashboard": { summary: { new_jobs: 12, due_followups: 3 }, priorities: [], funnels: {} } });
    renderAt(<AppLayout />, { path: "/interviews", route: "/interviews" });
    const menu = screen.getByRole("navigation", { name: "Main" });
    expect(within(menu).getAllByRole("link").map((l) => l.textContent?.replace(/\d+$/, ""))).toEqual(
      ["Today", "Jobs", "Pipeline", "Follow-ups", "Reports", "My profile", "Settings"]);
    expect(await within(menu).findByTitle("New jobs to review")).toHaveTextContent("12");
    expect(within(menu).getByTitle("Due today or overdue")).toHaveTextContent("3");
    expect(within(menu).getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
    const tabs = screen.getByRole("navigation", { name: "Pipeline pages" });
    expect(within(tabs).getByRole("link", { name: "Interviews" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Recruiters" })).toHaveAttribute("href", "/recruiters");
  });

  it("switches theme and remembers it", async () => {
    mockApi({ "GET /dashboard": { summary: {}, priorities: [], funnels: {} } });
    renderAt(<AppLayout />, { path: "/", route: "/" });
    const group = screen.getByRole("group", { name: "Theme" });
    await userEvent.click(within(group).getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    await userEvent.click(within(group).getByRole("button", { name: "Light theme" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(within(group).getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the menu for full-width pages, and remembers it", async () => {
    mockApi({ "GET /dashboard": { summary: {}, priorities: [], funnels: {} } });
    const first = renderAt(<AppLayout />, { path: "/jobs", route: "/jobs" });
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("max-w-[1440px]");
    await userEvent.click(screen.getByRole("button", { name: "Hide menu" }));
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveClass("max-w-[1440px]"); // full width
    first.unmount();
    renderAt(<AppLayout />, { path: "/jobs", route: "/jobs" });
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show menu" }));
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("finds the section and tab for any page", () => {
    expect(locate("/jobs/review").tab?.label).toBe("Review new");
    expect(locate("/jobs/42").tab?.label).toBe("All jobs");
    expect(locate("/companies/3").section?.label).toBe("Jobs");
    expect(locate("/preferences").section?.label).toBe("My profile");
    expect(locate("/analytics").section?.label).toBe("Today");
    expect(locate("/").tab?.label).toBe("Today");
  });
});

const fu = (id: number, title: string, due: string, extra: object = {}) => ({
  id, title, due_date: due, kind: "APPLICATION", job_id: 5, job_title: "Magento Lead", job_status: "APPLIED",
  job_url: "https://acme.example/5", company_name: "Acme", contact_name: null, application_id: 1, notes: null,
  completed: false, overdue: due < inDays(0), ...extra,
});

describe("follow-ups", () => {
  it("groups by urgency and acts in one click", async () => {
    const api = mockApi({
      "GET /followups": (url: URL) => url.searchParams.get("completed") === "true" ? { items: [], total: 0 } : {
        items: [fu(1, "Ping Acme", inDays(-2)), fu(2, "Thank-you note", inDays(0)), fu(3, "Check status", inDays(3)), fu(4, "Ask again", inDays(20))],
        total: 4, page: 1, size: 200,
      },
      "POST /followups/1/complete": { ok: true },
      "PATCH /followups/2": { ok: true },
    });
    renderAt(<FollowupsPage />, { path: "/followups", route: "/followups" });
    const late = await screen.findByRole("region", { name: "Late" });
    expect(within(late).getByText("Ping Acme")).toBeInTheDocument();
    expect(within(late).getByText("2 days late")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Today" })).getByText("Thank-you note")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "This week" })).getByText("Check status")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Later" })).getByText("Ask again")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // to do today (late + today)

    expect(within(late).getByRole("link", { name: "Ping Acme" })).toHaveAttribute("href", "/jobs/5");
    await userEvent.click(within(late).getByRole("button", { name: "Done: Ping Acme" }));
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/followups/1/complete")).toBe(true);
    await userEvent.click(within(screen.getByRole("region", { name: "Today" })).getByRole("button", { name: "+1 week" }));
    expect(api.calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/followups/2", body: { due_date: inDays(7) } });
  });

  it("offers only Dismiss when the job is already finished", async () => {
    mockApi({ "GET /followups": { items: [fu(7, "Follow up: Magento Lead", inDays(1), { job_status: "REJECTED" })], total: 1, page: 1, size: 200 } });
    renderAt(<FollowupsPage />, { path: "/followups", route: "/followups" });
    expect(await screen.findByText("No longer needed — this job is rejected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss: Follow up: Magento Lead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+1 week" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Magento Lead" })).toBeInTheDocument(); // auto title shows the job once
  });

  it("describes due dates in plain words", () => {
    expect(dueLabel(inDays(0))).toBe("today");
    expect(dueLabel(inDays(1))).toBe("tomorrow");
    expect(dueLabel(inDays(4))).toBe("in 4 days");
    expect(dueLabel(inDays(-1))).toBe("1 day late");
  });
});

const JOB = {
  id: 9, title: "Magento Lead", status: "NEW", match_score: 84, score_stale: false, jd_status: "OK",
  company: { id: 1, name: "Acme", tier: "TIER_A", verification_status: "VERIFIED" }, location: "Jaipur", locations: [],
  work_model: "REMOTE", experience_min: "8", experience_max: null, salary_min: null, salary_max: null, salary_currency: null,
  salary_text: null, posting_date: "2026-10-01", application_deadline: null, employment_type: null, seniority: "SENIOR",
  source_url: "https://acme.example/jobs/9", source_links: [], added_via: ["scanner"], original_jd: "Lead our Magento team.",
  parsed_jd: {}, responsibilities: [], qualifications: [], required_skills: ["Magento"], preferred_skills: [], manual_fields: [],
  notes: null, activity: [], comments: [], recruiter: null, recommended_cv: { id: 2, name: "Tech Lead CV", target_role: null, version_id: 3 },
  career_ops: null, career_ops_evaluation: null, created_at: "2026-10-02T10:00:00Z", analyzed_at: null, score_version: null,
  match: { score: 84, recommendation: "RECOMMENDED", confidence: "HIGH", strong_matches: ["Magento"], missing: [], blockers: [],
    components: [{ key: "role", label: "Role", weight: 20, factor: 1, points: 20, reasons: ["Title matches your target roles"] }],
    skills: [], experience_fit: "GOOD", salary_status: "UNKNOWN", location_fit: "PREFERRED", action: "APPLY" },
};
const empty = { items: [], total: 0, page: 1, size: 50 };

describe("job page", () => {
  it("leads with the next step and plans follow-ups for the job", async () => {
    const api = mockApi({
      "GET /jobs/9": JOB, "GET /applications": empty, "GET /interviews": empty, "GET /followups": empty,
      "POST /jobs/9/status": { ok: true }, "POST /followups": { id: 1 },
    });
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/9" });
    expect(await screen.findByText("Is this worth applying to?")).toBeInTheDocument();
    expect(screen.getByText("✓ Title matches your target roles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open posting ↗" })).toHaveAttribute("href", "https://acme.example/jobs/9");
    await userEvent.click(screen.getByRole("button", { name: "★ Shortlist" }));
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/jobs/9/status")?.body).toEqual({ status: "SHORTLISTED" });

    await userEvent.click(screen.getByRole("button", { name: "in a week" }));
    expect(api.calls.find((c) => c.path === "/followups" && c.method === "POST")?.body)
      .toMatchObject({ title: "Follow up: Magento Lead", job_id: 9, due_date: inDays(7) });
  });

  it("opens the apply form from the list's Apply link", async () => {
    mockApi({
      "GET /jobs/9": { ...JOB, status: "SHORTLISTED" }, "GET /applications": empty, "GET /interviews": empty,
      "GET /followups": empty, "GET /cvs": empty,
    });
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/9?apply=1" });
    expect(await screen.findByText(/Ready to apply — send your “Tech Lead CV” CV/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record application" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1. Apply on the site ↗" })).toBeInTheDocument();
  });

  it("marks an interview as done with no reply, then offers the ways out", async () => {
    const api = mockApi({
      "GET /jobs/9": { ...JOB, status: "INTERVIEW" }, "GET /applications": empty, "GET /interviews": empty,
      "GET /followups": empty, "POST /jobs/9/status": { ok: true },
    });
    const { unmount } = renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/9" });
    await userEvent.click(await screen.findByRole("button", { name: "Interview done – no reply" }));
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/jobs/9/status")?.body).toEqual({ status: "AWAITING_FEEDBACK" });
    unmount();

    mockApi({
      "GET /jobs/9": { ...JOB, status: "AWAITING_FEEDBACK" }, "GET /applications": empty, "GET /interviews": empty,
      "GET /followups": empty,
    });
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/9" });
    expect(await screen.findByText(/HR hasn't replied yet/)).toBeInTheDocument();
    expect(screen.getAllByText("Interview done – no reply").length).toBeGreaterThan(0); // badge + status menu
    for (const name of ["Got an offer", "Rejected"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next round" })).toBeInTheDocument();
  });

  const applyRoutes = {
    "GET /jobs/9": { ...JOB, status: "SHORTLISTED" }, "GET /applications": empty, "GET /interviews": empty,
    "GET /followups": empty, "GET /cvs": empty, "POST /applications": { id: 1 },
  };
  const applied = (api: ReturnType<typeof mockApi>) =>
    api.calls.find((c) => c.method === "POST" && c.path === "/applications")?.body as Record<string, unknown>;

  it("records the applied date the user picks", async () => {
    const api = mockApi(applyRoutes);
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/9?apply=1" });
    const picker = await screen.findByLabelText("Applied on");
    expect(picker).toHaveAttribute("type", "date");
    expect(picker).toHaveAttribute("max", inDays(0)); // no future dates
    await userEvent.type(picker, inDays(-5));
    expect(screen.getByText(/Will be recorded as applied on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record application" }));
    expect(applied(api)).toMatchObject({ job_id: 9, applied_on: inDays(-5) });
  });

  it("uses today when no applied date is picked", async () => {
    const api = mockApi(applyRoutes);
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/9?apply=1" });
    expect(await screen.findByText("Applied date: today. Pick a date if you applied earlier.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record application" }));
    expect(applied(api)).toMatchObject({ job_id: 9 });
    expect(applied(api)).not.toHaveProperty("applied_on"); // the server records today
  });
});
