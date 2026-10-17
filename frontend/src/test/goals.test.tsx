import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReminderToggle, dueNotes, type RemindersData } from "../components/Reminders";
import { WeeklyGoals, type Week } from "../features/dashboard/WeeklyGoals";
import { mockApi, renderAt } from "./utils";

const goal = (key: string, label: string, target: number, done: number) =>
  ({ key, label, hint: "", to: "/x", target, done, left: Math.max(target - done, 0), per_day: Math.ceil(Math.max(target - done, 0) / 3), last_week: 4 });
const WEEK: Week = {
  week_start: "2026-10-12", week_end: "2026-10-18", days_left: 3, streak: 2, all_met: false,
  goals: [{ ...goal("applications", "Applications sent", 10, 4), approximate: 3 }, goal("reviewed", "New jobs reviewed", 30, 31),
    goal("followups", "Follow-ups done", 5, 0), goal("outreach", "Recruiters contacted", 0, 0)],
};

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("WeeklyGoals", () => {
  it("shows progress, pace, last week and the streak; goals set to 0 are hidden", async () => {
    mockApi({ "GET /goals/week": WEEK });
    renderAt(<WeeklyGoals />);
    expect(await screen.findByText("Applications sent")).toBeInTheDocument();
    expect(screen.getByText(/6 to go · about 2 a day/)).toBeInTheDocument();
    expect(screen.getByText("Done for this week ✓")).toBeInTheDocument();
    expect(screen.getByText(/2 weeks in a row met/)).toBeInTheDocument();
    expect(screen.getByText(/incl. 3 recorded automatically/)).toBeInTheDocument();
    expect(screen.queryByText("Recruiters contacted")).not.toBeInTheDocument();
  });

  it("changes the targets", async () => {
    const api = mockApi({ "GET /goals/week": WEEK, "PATCH /settings/app": {} });
    renderAt(<WeeklyGoals />);
    fireEvent.click(await screen.findByRole("button", { name: "Change goals" }));
    fireEvent.change(screen.getByLabelText("Applications sent target"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goals" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body)
      .toEqual({ goals: { applications: 15, reviewed: 30, followups: 5, outreach: 0 } }));
  });
});

describe("reminders", () => {
  const data: RemindersData = {
    followups: [{ id: 1, title: "Ping Acme HR", due_date: "2026-10-14", late_days: 2, job_id: 9 }],
    interviews: [
      { id: 3, job_id: 9, round: 2, round_type: "TECHNICAL", scheduled_at: "2026-10-17T05:00:00Z", meeting_link: null, job_title: "Tech Lead", company: "Acme", minutes_until: 600 },
      { id: 4, job_id: 8, round: 1, round_type: "HR", scheduled_at: "2026-10-16T10:30:00Z", meeting_link: null, job_title: "Architect", company: "Beta", minutes_until: 25 },
    ],
  };

  it("says what to notify once: a follow-up per day, an interview within a day and again within the hour", () => {
    const notes = dueNotes(data, new Set(), "Fri Oct 16 2026");
    expect(notes.map((n) => n.key)).toEqual(["fu:1:Fri Oct 16 2026", "iv:3:day", "iv:4:hour"]);
    expect(notes[0]).toMatchObject({ title: "Follow-up 2 days late", body: "Ping Acme HR", url: "/jobs/9#follow-ups" });
    expect(notes[2].title).toBe("Interview in 25 min");
    expect(dueNotes(data, new Set(notes.map((n) => n.key)), "Fri Oct 16 2026")).toEqual([]);
    expect(dueNotes(data, new Set(notes.map((n) => n.key)), "Sat Oct 17 2026").map((n) => n.key)).toEqual(["fu:1:Sat Oct 17 2026"]);
  });

  it("sums up many follow-ups in one notification", () => {
    const many = { followups: [1, 2, 3, 4].map((id) => ({ ...data.followups[0], id, title: `F${id}` })), interviews: [] };
    expect(dueNotes(many, new Set(), "d")).toEqual([{ key: "fus:d", title: "4 follow-ups due", body: "F1 · F2 · F3 …", url: "/followups" }]);
  });

  it("turns on after the browser allows it", async () => {
    const shown: string[] = [];
    class FakeNotification {
      static permission = "default";
      static requestPermission = vi.fn(async () => { FakeNotification.permission = "granted"; return "granted"; });
      constructor(title: string) { shown.push(title); }
    }
    vi.stubGlobal("Notification", FakeNotification);
    renderAt(<ReminderToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on reminders" }));
    expect(await screen.findByText(/Browser reminders are on/)).toBeInTheDocument();
    expect(shown).toEqual(["Reminders are on"]);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(screen.getByRole("button", { name: "Turn on reminders" })).toBeInTheDocument();
  });
});
