import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardPage } from "../features/applications/BoardPage";
import { inDays } from "../features/followups/FollowUpParts";
import { locate } from "../layouts/AppLayout";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const daysAgo = (n: number) => inDays(-n); // local dates, like the board
const app = (id: number, status: string, extra: object = {}) => ({
  id, job_id: id, job_title: `Job ${id}`, company_id: 1, company_name: `Co ${id}`, match_score: 80, applied_on: daysAgo(12),
  method: "OTHER", cv_version_id: null, cv_name: null, recruiter_name: null, referral_name: null, status, expected_salary: null,
  salary_currency: null, notice_period_days: null, follow_up_date: null, notes: null, origin: "manual", events: [],
  updated_at: new Date().toISOString(), ...extra,
});

describe("pipeline board", () => {
  it("is the first Pipeline tab", () => {
    expect(locate("/applications/board").tab?.label).toBe("Board");
    expect(locate("/applications/7").tab?.label).toBe("Applications");
  });

  it("groups applications by stage and flags what needs attention", async () => {
    mockApi({ "GET /applications": { items: [
      app(1, "APPLIED", { follow_up_date: daysAgo(2) }),
      app(2, "APPLIED", { updated_at: new Date(Date.now() - 20 * 86_400_000).toISOString() }),
      app(3, "AWAITING_FEEDBACK", { origin: "auto" }), app(4, "REJECTED"), app(5, "WITHDRAWN"),
    ], total: 5, page: 1, size: 200 } });
    renderAt(<BoardPage />);
    const applied = await screen.findByRole("region", { name: "Applied" });
    expect(within(applied).getAllByRole("listitem")).toHaveLength(2);
    expect(within(applied).getByText("Follow-up 2 days late")).toBeInTheDocument();
    expect(within(applied).getByText("No update in 14+ days")).toBeInTheDocument();
    expect(within(applied).getAllByText("Applied 12 days ago")).toHaveLength(2);
    const waiting = screen.getByRole("region", { name: "Interview done – no reply" });
    expect(within(waiting).getByText("Job 3")).toBeInTheDocument();
    expect(within(waiting).getByText(/date approximate/)).toBeInTheDocument(); // recorded automatically
    expect(screen.getByRole("link", { name: "Withdrawn: 1" })).toHaveAttribute("href", "/applications?status=WITHDRAWN");
    expect(screen.getByLabelText("Pipeline summary")).toHaveTextContent("1 follow-up due · 1 quiet 14+ days");
    expect(screen.getByTestId("open-count")).toHaveTextContent("3"); // 3 open, 2 finished
  });

  it("moves a card with its Move to… menu", async () => {
    const api = mockApi({
      "GET /applications": { items: [app(1, "APPLIED")], total: 1, page: 1, size: 200 },
      "POST /applications/1/status": { ok: true },
    });
    renderAt(<BoardPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Move Job 1 to"), "SCREENING");
    expect(api.calls.find((c) => c.path === "/applications/1/status")?.body).toEqual({ status: "SCREENING", note: "Moved on the board" });
  });

  it("moves a card by drag and drop", async () => {
    const api = mockApi({
      "GET /applications": { items: [app(2, "SCREENING")], total: 1, page: 1, size: 200 },
      "POST /applications/2/status": { ok: true },
    });
    renderAt(<BoardPage />);
    const card = await screen.findByRole("listitem", { name: "Job 2 at Co 2" });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    const target = screen.getByRole("region", { name: "Interview" });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await vi.waitFor(() => expect(api.calls.find((c) => c.path === "/applications/2/status")?.body).toEqual({ status: "INTERVIEW", note: "Moved on the board" }));
  });

  it("summarises the funnel, filters to what needs attention and moves to the next stage", async () => {
    const api = mockApi({
      "GET /applications": { items: [
        app(1, "APPLIED", { follow_up_date: daysAgo(1) }),
        app(2, "SCREENING"),
        app(3, "REJECTED", { events: [{ id: 1, event_type: "STATUS", from_status: "SCREENING", to_status: "INTERVIEW", note: null, occurred_at: "" }] }),
        app(4, "OFFER"),
      ], total: 4, page: 1, size: 200 },
      "POST /applications/2/status": { ok: true },
    });
    renderAt(<BoardPage />);
    const summary = await screen.findByLabelText("Pipeline summary");
    // A rejected application that had reached an interview still counts as interviewed.
    expect(summary).toHaveTextContent("Got a reply375%");
    expect(summary).toHaveTextContent("Interviewed250%");
    expect(summary).toHaveTextContent("Offers125%");

    await userEvent.click(screen.getByLabelText("Needs attention only"));
    expect(screen.getAllByRole("listitem", { name: /at Co/ })).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("Needs attention only"));

    await userEvent.click(screen.getByLabelText("Hide accepted & rejected"));
    expect(screen.queryByRole("region", { name: "Rejected" })).not.toBeInTheDocument();

    const screening = screen.getByRole("region", { name: "Screening" });
    await userEvent.click(within(screening).getByRole("button", { name: "Interview →" }));
    await vi.waitFor(() => expect(api.calls.find((c) => c.path === "/applications/2/status")?.body).toEqual({ status: "INTERVIEW", note: "Moved on the board" }));
  });

  it("explains how cards get there when there are none", async () => {
    mockApi({ "GET /applications": { items: [], total: 0, page: 1, size: 200 } });
    renderAt(<BoardPage />);
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
  });
});
