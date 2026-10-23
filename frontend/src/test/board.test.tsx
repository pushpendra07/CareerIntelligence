import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardPage } from "../features/applications/BoardPage";
import { inDays } from "../features/followups/FollowUpParts";
import { locate } from "../layouts/AppLayout";
import { mockApi, renderAt } from "./utils";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const daysAgo = (n: number) => inDays(-n); // local dates, like the pipeline
const app = (id: number, status: string, extra: object = {}) => ({
  id, job_id: id, job_title: `Job ${id}`, company_id: 1, company_name: `Co ${id}`, match_score: 80, applied_on: daysAgo(12),
  method: "OTHER", cv_version_id: null, cv_name: null, recruiter_name: null, referral_name: null, status, expected_salary: null,
  salary_currency: null, notice_period_days: null, follow_up_date: null, notes: null, origin: "manual", events: [],
  updated_at: new Date().toISOString(), ...extra,
});
const NOTE = "Updated on the pipeline";
const rowOf = (name: string) => screen.getByRole("row", { name });

describe("pipeline list", () => {
  it("is the first Pipeline tab", () => {
    expect(locate("/applications/board").tab?.label).toBe("Pipeline");
    expect(locate("/applications/7").tab?.label).toBe("Applications");
  });

  it("lists every application with its status, filters by stage and flags what needs attention", async () => {
    mockApi({ "GET /applications": { items: [
      app(1, "APPLIED", { follow_up_date: daysAgo(2) }),
      app(2, "APPLIED", { updated_at: new Date(Date.now() - 20 * 86_400_000).toISOString() }),
      app(3, "AWAITING_FEEDBACK", { origin: "auto" }), app(4, "REJECTED"), app(5, "WITHDRAWN"),
    ], total: 5, page: 1, size: 200 } });
    renderAt(<BoardPage />);
    await screen.findByRole("row", { name: "Job 1 at Co 1" });
    expect(screen.getAllByRole("row", { name: /at Co/ })).toHaveLength(3); // All open: finished ones are in their tabs
    expect(within(rowOf("Job 1 at Co 1")).getByText("2 days late")).toBeInTheDocument();
    expect(within(rowOf("Job 2 at Co 2")).getByText("No update in 14+ days")).toBeInTheDocument();
    expect(within(rowOf("Job 3 at Co 3")).getByText(/date approximate/)).toBeInTheDocument(); // recorded automatically
    expect(screen.getByLabelText("Status of Job 3")).toHaveValue("AWAITING_FEEDBACK");
    expect(screen.getByLabelText("Pipeline summary")).toHaveTextContent("1 follow-up due · 1 quiet 14+ days");
    expect(screen.getByTestId("open-count")).toHaveTextContent("3"); // 3 open, 2 finished

    const stages = screen.getByRole("tablist", { name: "Application stage" });
    expect(within(stages).getByRole("tab", { name: /All open/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(stages).getByRole("tab", { name: /^All\s*5/ }));
    expect(screen.getAllByRole("row", { name: /at Co/ })).toHaveLength(5);
    await userEvent.click(within(stages).getByRole("tab", { name: /Applied\s*2/ }));
    expect(screen.getAllByRole("row", { name: /at Co/ })).toHaveLength(2);
    await userEvent.click(within(stages).getByRole("tab", { name: /Withdrawn\s*1/ }));
    expect(screen.getAllByRole("row", { name: /at Co/ }).map((r) => r.getAttribute("aria-label"))).toEqual(["Job 5 at Co 5"]);
  });

  it("changes a status from its row", async () => {
    const api = mockApi({
      "GET /applications": { items: [app(1, "APPLIED")], total: 1, page: 1, size: 200 },
      "POST /applications/1/status": { ok: true },
    });
    renderAt(<BoardPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Status of Job 1"), "SCREENING");
    expect(api.calls.find((c) => c.path === "/applications/1/status")?.body).toEqual({ status: "SCREENING", note: NOTE });
  });

  it("changes the status of several applications at once", async () => {
    const api = mockApi({
      "GET /applications": { items: [app(1, "APPLIED"), app(2, "SCREENING"), app(3, "INTERVIEW")], total: 3, page: 1, size: 200 },
      "POST /applications/1/status": { ok: true }, "POST /applications/2/status": { ok: true },
    });
    renderAt(<BoardPage />);
    await userEvent.click(await screen.findByLabelText("Select Job 1"));
    await userEvent.click(screen.getByLabelText("Select Job 2"));
    expect(screen.getByLabelText("Change selected")).toHaveTextContent("2 selected");
    await userEvent.selectOptions(screen.getByLabelText("New status for selected"), "REJECTED");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await vi.waitFor(() => expect(api.calls.filter((c) => c.method === "POST").map((c) => [c.path, (c.body as { status: string }).status])).toEqual([
      ["/applications/1/status", "REJECTED"], ["/applications/2/status", "REJECTED"]]));
    await vi.waitFor(() => expect(screen.queryByLabelText("Change selected")).not.toBeInTheDocument());
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
    expect(screen.getAllByRole("row", { name: /at Co/ })).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("Needs attention only"));

    expect(screen.queryByRole("row", { name: "Job 3 at Co 3" })).not.toBeInTheDocument(); // rejected: not in All open

    await userEvent.click(within(rowOf("Job 2 at Co 2")).getByRole("button", { name: "Interview →" }));
    await vi.waitFor(() => expect(api.calls.find((c) => c.path === "/applications/2/status")?.body).toEqual({ status: "INTERVIEW", note: NOTE }));
  });

  it("pages a long list", async () => {
    mockApi({ "GET /applications": { items: Array.from({ length: 30 }, (_, i) => app(i + 1, "APPLIED", { applied_on: daysAgo(i) })),
      total: 30, page: 1, size: 200 } });
    renderAt(<BoardPage />);
    await screen.findByRole("row", { name: "Job 1 at Co 1" });
    expect(screen.getAllByRole("row", { name: /at Co/ })).toHaveLength(25);
    expect(screen.getAllByText(/Showing/)[0]).toHaveTextContent("Showing 1–25 of 30 applications");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row", { name: /at Co/ })).toHaveLength(5);
    await userEvent.click(screen.getByLabelText("Select all on this page"));
    expect(screen.getByLabelText("Change selected")).toHaveTextContent("5 selected");
  });

  it("explains how applications get there when there are none", async () => {
    mockApi({ "GET /applications": { items: [], total: 0, page: 1, size: 200 } });
    renderAt(<BoardPage />);
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
  });
});
