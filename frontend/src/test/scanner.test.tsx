import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScannerSettings } from "../features/scanner/ScannerSettings";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SETTINGS = {
  title_include: ["magento", "php"], title_broad: ["tech lead"], jd_keywords: ["magento"], title_exclude: ["intern"],
  locations: ["india", "remote"], location_exclude: ["usa"], keep_unknown_location: true,
  max_age_days: 45, max_new_per_company: 50, schedule_hours: 0,
};
const LAST = { id: 7, kind: "SCAN", trigger: "manual", status: "COMPLETED", started_at: "2026-10-09T08:00:00Z", finished_at: "2026-10-09T08:01:00Z",
  stats: { companies: 33, found: 2800, kept: 3, new: 2, updated: 1, errors: 1, skipped: { title: 2000 } } };
const STATUS = { supported_boards: ["GREENHOUSE"], job_search_enabled: 40, scannable: 33, by_provider: { GREENHOUSE: 20, LEVER: 13 },
  not_scannable: [{ id: 5, name: "Plain Co", careers_url: null }], running: null, last_run: LAST, settings: SETTINGS };

describe("job scanner settings", () => {
  it("shows coverage and the last scan, starts a scan and saves filters", async () => {
    const api = mockApi({
      "GET /scanner/status": STATUS,
      "POST /scanner/run": { ...LAST, id: 8, status: "RUNNING", stats: {} },
      "PATCH /settings/app": { scanner: SETTINGS },
      "GET /scanner/runs/7": { ...LAST, companies: [{ company_id: 1, company: "Acme", provider: "GREENHOUSE", board: "https://job-boards.greenhouse.io/acme", found: 10, kept: 2, new: 2, error: null }] },
    });
    renderAt(<ScannerSettings />);
    expect(await screen.findByText(/2 new · 1 updated · 2800 postings checked at 33 companies · 1 board errors/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View new jobs" })).toHaveAttribute("href", "/jobs?status=NEW&sort=-match_score");

    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/companies/1");
    expect(screen.getByText(/2000 title not relevant/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/scanner/run")).toBe(true);

    await userEvent.click(screen.getByText("What to keep (filters & schedule)"));
    const titles = screen.getByLabelText("Titles to keep");
    await userEvent.clear(titles);
    await userEvent.type(titles, "magento, adobe commerce,");
    await userEvent.click(screen.getByRole("button", { name: "Save filters" }));
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect((patch?.body as { scanner: { title_include: string[] } }).scanner.title_include).toEqual(["magento", "adobe commerce"]);
  });
});
