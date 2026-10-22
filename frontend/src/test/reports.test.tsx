import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsPage, matches, toCsv, type Report } from "../features/reports/ReportsPage";
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
  jobs: {
    title: "Jobs found or applied to in the period", total: 1,
    columns: [{ key: "title", label: "Job", kind: "job" }, { key: "work_model", label: "Work model", kind: "code" }],
    rows: [{ id: 8, title: "Commerce Architect", work_model: "REMOTE" }],
  },
};
const CATALOG = [{ key: "overview", title: "Overview", description: "" }, { key: "applications", title: "Applications", description: "" }];

afterEach(() => vi.unstubAllGlobals());

describe("ReportsPage", () => {
  it("shows KPIs with the change, charts, and a sortable, filterable table", async () => {
    const api = mockApi({ "GET /reports": CATALOG, "GET /reports/applications": REPORT });
    renderAt(<ReportsPage />, { path: "/reports/:name", route: "/reports/applications?range=30d" });
    expect(await screen.findByText("▲ 50%")).toHaveClass("text-emerald-600"); // 12 vs 8
    expect(screen.getByText("vs 8 before")).toBeInTheDocument();
    expect(screen.getByText("▲ 2")).toHaveClass("text-rose-600"); // more rejections is worse; 3 vs 1: no % from a tiny base
    expect(screen.getByRole("img", { name: "Where they are now chart" })).toBeInTheDocument();
    expect(screen.getByText("Nothing in this period")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Magento Lead" })).toHaveAttribute("href", "/jobs/5");
    expect(screen.getByText("Interview")).toBeInTheDocument();
    const call = api.calls.find((c) => c.path === "/reports/applications");
    expect(call).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter rows: Applications in the period"), { target: { value: "php" } });
    expect(screen.queryByText("Magento Lead")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter rows: Applications in the period"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Score" })); // highest first
    fireEvent.click(screen.getByRole("button", { name: /Score/ })); // then lowest first
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(cells[0]).toContain("PHP Architect");
  });

  it("groups the reports by area and lists what the numbers say", async () => {
    const catalog = [
      { key: "overview", title: "Overview", description: "", section: "Summary" },
      { key: "pipeline", title: "Pipeline health", description: "", section: "Pipeline" },
      { key: "market", title: "Market & pay", description: "", section: "Market" },
    ];
    const report = { ...REPORT, report: "pipeline", kpis: [
      { key: "answer_rate", label: "Answer rate", value: 20, previous: 35, unit: "%", better: "up" as const },
      { key: "dismissed", label: "Dismissed", value: 30, previous: 10, unit: "", better: "none" as const },
      { key: "days", label: "Days to first answer", value: 2, previous: 30, unit: " days", better: "down" as const, sample: [9, 2] },
    ], findings: [
      { tone: "bad" as const, text: "3 active applications have had no update for 14+ days.", link: "/applications" },
      { tone: "info" as const, text: "Employers answered in 6 days (median of 9 answers)." },
    ] };
    mockApi({ "GET /reports": catalog, "GET /reports/pipeline": report });
    renderAt(<ReportsPage />, { path: "/reports/:name", route: "/reports/pipeline" });
    expect(await screen.findByRole("link", { name: "Pipeline health" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Reports" })).toHaveTextContent(/Summary.*Overview.*Pipeline.*Pipeline health.*Market.*Market & pay/);
    expect(await screen.findByText("▼ 15 pts")).toHaveClass("text-rose-600"); // a rate changes in points
    expect(screen.getByText("▲ 200%")).toHaveClass("text-slate-500"); // neutral KPI: no colour
    expect(screen.getByText("30 days before · too few to compare")).toBeInTheDocument(); // 2 cases before
    const list = screen.getByRole("list", { name: "Key findings" });
    expect(list).toHaveTextContent(/no update for 14\+ days.*Employers answered/);
    expect(screen.getByLabelText("Needs attention")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Act on it →" })).toHaveAttribute("href", "/applications");
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

  it("Today asks for today's date only; the default stays the last 90 days", async () => {
    const urls: string[] = [];
    mockApi({ "GET /reports": CATALOG, "GET /reports/overview": (u: URL) => { urls.push(u.search); return { ...REPORT, report: "overview" }; } });
    renderAt(<ReportsPage />, { path: "/reports", route: "/reports" });
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await waitFor(() => expect(urls[0]).toContain(`to=${today}`));
    expect(urls[0]).not.toContain(`from=${today}`);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "today" } });
    await waitFor(() => expect(urls.at(-1)).toContain(`from=${today}&to=${today}`));
  });

  it("lists the jobs behind the numbers under the report", async () => {
    mockApi({ "GET /reports": CATALOG, "GET /reports/applications": REPORT });
    renderAt(<ReportsPage />, { path: "/reports/:name", route: "/reports/applications" });
    expect(await screen.findByText(/Jobs found or applied to in the period \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Commerce Architect" })).toHaveAttribute("href", "/jobs/8");
  });

  it("pages long tables (25 rows a page) and the filter starts again on page 1", async () => {
    localStorage.removeItem("reports.pageSize.v1");
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: `Job ${i + 1}`, work_model: "REMOTE" }));
    mockApi({ "GET /reports": CATALOG, "GET /reports/applications": { ...REPORT, jobs: { ...REPORT.jobs!, rows, total: 60 } } });
    renderAt(<ReportsPage />, { path: "/reports/:name", route: "/reports/applications" });
    expect(await screen.findByRole("link", { name: "Job 1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Job 26" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /next/i }).at(-1)!);
    expect(await screen.findByRole("link", { name: "Job 26" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Job 1" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Filter rows: Jobs found/), { target: { value: "Job 7" } });
    expect(screen.getByRole("link", { name: "Job 7" })).toBeInTheDocument(); // back on page 1
  });

  it("filters rows by a clicked chart item (lists by membership; rows without the field stay)", () => {
    const pick = { key: "work_model", code: "REMOTE", label: "Remote", chart: "wm" };
    expect(matches({ work_model: "REMOTE" }, pick)).toBe(true);
    expect(matches({ work_model: "HYBRID" }, pick)).toBe(false);
    expect(matches({ period: "2026-10-01" }, pick)).toBe(true);
    expect(matches({ skills: ["PHP", "Magento 2"] }, { ...pick, key: "skills", code: "PHP" })).toBe(true);
    expect(matches({ skills: ["Java"] }, { ...pick, key: "skills", code: "PHP" })).toBe(false);
    expect(matches({ work_model: "HYBRID" }, null)).toBe(true);
  });

  it("exports CSV with readable codes and quoted text", () => {
    const csv = toCsv(REPORT.table.columns, [{ id: 1, title: 'Lead, "Senior"', status: "AWAITING_FEEDBACK", score: null }]);
    expect(csv.split("\n")[1]).toBe('"Lead, ""Senior""",Interview done – no reply,');
  });
});
