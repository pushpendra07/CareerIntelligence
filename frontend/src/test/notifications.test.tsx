import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bellItems, newJobsNote, NotificationBell, type RemindersData } from "../components/Reminders";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const job = (id: number, title: string, company: string, extra: object = {}) => ({
  job_id: id, job_title: title, company, location: "Pune", work_model: "HYBRID", score: 82, job_status: "NEW",
  applied: false, applied_on: null, application_status: null, application_id: null, added_on: "2026-10-17T09:00:00Z", ...extra });

const DATA: RemindersData = {
  followups: [{ ...job(9, "Senior Developer", "Umbrella", { applied: true, applied_on: "2026-10-09", application_status: "APPLIED" }),
    id: 1, title: "Follow up: Senior Developer", due_date: "2026-10-15", late_days: 2 }],
  interviews: [{ id: 4, job_id: 9, round: 2, round_type: "TECHNICAL", scheduled_at: "2026-10-18T10:00:00Z",
    meeting_link: null, job_title: "Tech Lead", company: "Acme", minutes_until: 45 }],
  apply_pending: [job(5, "Platform Lead", "Initech", { job_status: "SHORTLISTED" })],
  new_jobs: [job(7, "Backend Engineer", "Globex")],
};
const EVENTS = [{ id: 3, rule_id: "check-portals", title: "Check job portals", body: "Look for new jobs on LinkedIn, Naukri.",
  url: "/jobs/new", test: false, created_at: new Date().toISOString() }];

describe("notifications", () => {
  it("each notification has the job, company, details and whether you applied", () => {
    const items = bellItems(DATA, { new_jobs: 12, new_70_plus: 3 }, EVENTS);
    expect(items.map((i) => i.kind)).toEqual(["interview", "followup", "apply", "new", "new", "reminder"]);
    const [, follow, apply, fresh, all, reminder] = items;
    expect(follow).toMatchObject({ title: "Senior Developer", company: "Umbrella", to: "/jobs/9#follow-ups" });
    expect(follow.details).toEqual(["Follow-up 2 days late", "Pune", "Hybrid", "score 82"]);
    expect(follow.status?.text).toMatch(/^Applied /);
    expect(apply).toMatchObject({ title: "Platform Lead", company: "Initech", to: "/jobs/5?apply=1" });
    expect(apply.details[0]).toBe("Shortlisted, waiting for your application");
    expect(apply.status?.text).toBe("Not applied");
    expect(fresh).toMatchObject({ title: "Backend Engineer", company: "Globex", to: "/jobs/7" });
    expect(all).toMatchObject({ title: "All 12 new jobs", to: "/jobs/review?min_score=70" });
    expect(reminder).toMatchObject({ title: "Check job portals", to: "/jobs/new" });
  });

  it("tells you when a scan found new jobs, once", () => {
    expect(newJobsNote(10, 2, null)).toBeNull(); // first visit: nothing to compare with
    expect(newJobsNote(10, 2, 10)).toBeNull();
    expect(newJobsNote(14, 2, 10)).toMatchObject({ title: "4 new jobs found", url: "/jobs/review" });
  });

  it("the bell groups notifications, filters them, and marks one or all as read", async () => {
    mockApi({ "GET /reminders": DATA, "GET /reminder-events": EVENTS });
    renderAt(<NotificationBell summary={{ new_jobs: 1, new_70_plus: 1 }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Notifications: 5 new" }));
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(panel).toHaveTextContent("Interview in 45 min");
    const follow = screen.getByRole("link", { name: /Senior Developer at Umbrella/ });
    expect(follow).toHaveAccessibleName(/Follow-up 2 days late.*Applied/);
    expect(screen.getByRole("link", { name: /Platform Lead at Initech.*Not applied/ })).toHaveAttribute("href", "/jobs/5?apply=1");

    await userEvent.click(within(panel).getByRole("button", { name: /^Apply pending/ }));
    expect(within(panel).getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/jobs/"))).toHaveLength(1);
    await userEvent.click(within(panel).getByRole("button", { name: /^All/ }));

    expect(document.title).toBe("(5) Career Intelligence"); // the tab shows the same count as the bell
    await userEvent.click(screen.getByRole("button", { name: "Mark as read: Interview in 45 min" }));
    expect(screen.getByRole("button", { name: "Notifications: 4 new" })).toBeInTheDocument();
    expect(document.title).toBe("(4) Career Intelligence");
    expect(panel).not.toHaveTextContent("Interview in 45 min"); // read: gone from the list
    await userEvent.click(screen.getByRole("button", { name: "Show 1 read" }));
    expect(panel).toHaveTextContent("Interview in 45 min");
    await userEvent.click(screen.getByRole("button", { name: "Hide read notifications" }));

    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("You're all caught up");
    expect(screen.getByRole("button", { name: "Show 5 read" })).toBeInTheDocument();
    expect(document.title).toBe("Career Intelligence");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opening an item marks it read", async () => {
    mockApi({ "GET /reminders": DATA, "GET /reminder-events": [] });
    renderAt(<NotificationBell summary={{ new_jobs: 0 }} />, { path: "*" }); // stays on screen after the link
    await userEvent.click(await screen.findByRole("button", { name: "Notifications: 4 new" }));
    await userEvent.click(screen.getByRole("link", { name: /Senior Developer at Umbrella/ }));
    expect(screen.getByRole("button", { name: "Notifications: 3 new" })).toBeInTheDocument();
  });

  it("says when everything is done", async () => {
    mockApi({ "GET /reminders": { followups: [], interviews: [] }, "GET /reminder-events": [] });
    renderAt(<NotificationBell summary={{ new_jobs: 0 }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(screen.getByText(/all caught up/)).toBeInTheDocument();
  });
});
