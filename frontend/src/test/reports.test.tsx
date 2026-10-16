import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsPage, toCsv, type Report } from "../features/reports/ReportsPage";
import { mockApi, renderAt } from "./utils";

const REPORT: Report = {
  report: "applications", title: "Applications", description: "What you applied to.",
  from: "2026-07-18", to: "2026-10-15", group: "week", previous: { from: "2026-04-19", to: "2026-07-17" },
  kpis: [
    { key: "apps", label: "Applications", value: 12, previous: 8, unit: "", better: "up" },
    { key: "rejected", label: "Rejected", value: 3, previous: 1, unit: "", better: "down" },
  ],
  charts: [
    { id: "status", title: "Where they are now", kind: "donut", note: null, series: [{ key: "value", label: "Count" }], data: [{ label: "Applied", value: 9 }] },
    { id: "empty", title: "Empty chart", kind: "bar", note: null, series: [{ key: "value", label: "Count" }], data: [] },
  ],
  table: {
    title: "Applications in the period", total: 2,
    columns: [{ key: "title", label: "Job", kind: "job" }, { key: "status", label: "Status", kind: "code" }, { key: "score", label: "Score", kind: "number" }],
    rows: [{ id: 5, title: "Magento Lead", status: "INTERVIEW", score: 91 }, { id: 6, title: "PHP Architect", status: "APPLIED", score: 70 }],
  },
};
const CATALOG = [{ key: "overview", title: "Overview", description: "" }, { key: "applications", title: "Applications", description: "" }];

afterEach(() => vi.unstubAllGlobals());

describe("ReportsPage", () => {
  it("shows KPIs with the change, charts, and a sortable, filterable table", async () => {
    const api = mockApi({ "GET /reports": CATALOG, "GET /reports/applications": REPORT });
    renderAt(<ReportsPage />, { path: "/reports/:name", route: "/reports/applications?range=30d" });
    expect(await screen.findByText("▲ 4 vs previous period")).toHaveClass("text-emerald-600");
    expect(screen.getByText("▲ 2 vs previous period")).toHaveClass("text-rose-600"); // more rejections is worse
    expect(screen.getByRole("img", { name: "Where they are now chart" })).toBeInTheDocument();
    expect(screen.getByText("Nothing in this period")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Magento Lead" })).toHaveAttribute("href", "/jobs/5");
    expect(screen.getByText("Interview")).toBeInTheDocument();
    const call = api.calls.find((c) => c.path === "/reports/applications");
    expect(call).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "php" } });
    expect(screen.queryByText("Magento Lead")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Score" })); // highest first
    fireEvent.click(screen.getByRole("button", { name: /Score/ })); // then lowest first
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(cells[0]).toContain("PHP Architect");
  });

  it("asks for the chosen dates and group", async () => {
    const urls: string[] = [];
    mockApi({ "GET /reports": CATALOG, "GET /reports/overview": (u: URL) => { urls.push(u.search); return { ...REPORT, report: "overview" }; } });
    renderAt(<ReportsPage />, { path: "/reports", route: "/reports?from=2026-01-01&to=2026-03-31" });
    await waitFor(() => expect(urls[0]).toContain("from=2026-01-01"));
    expect(urls[0]).toContain("to=2026-03-31");
    fireEvent.change(await screen.findByLabelText("Group by"), { target: { value: "month" } });
    await waitFor(() => expect(urls.at(-1)).toContain("group=month"));
    expect(screen.getByRole("link", { name: "Applications" })).toHaveAttribute("href", "/reports/applications?from=2026-01-01&to=2026-03-31&group=month");
  });

  it("exports CSV with readable codes and quoted text", () => {
    const csv = toCsv(REPORT.table.columns, [{ id: 1, title: 'Lead, "Senior"', status: "AWAITING_FEEDBACK", score: null }]);
    expect(csv.split("\n")[1]).toBe('"Lead, ""Senior""",Interview done – no reply,');
  });
});
