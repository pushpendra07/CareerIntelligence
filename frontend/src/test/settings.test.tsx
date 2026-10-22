import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locate } from "../layouts/AppLayout";
import { SettingsPage } from "../features/settings/SettingsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SCORING = { version: 4, config: {
  weights: { role: 20, skills: 25, experience: 15, domain: 10, location: 10, seniority: 5, salary: 5, company: 5, other: 5 },
  thresholds: { highly_recommended: 90, recommended: 80, consider: 70, low_priority: 60 },
  tier_factors: { TIER_A: 1, TIER_B: 0.6 }, hard_blockers: [],
} };

describe("settings", () => {
  it("has one tab per purpose", () => {
    expect(locate("/settings").tab?.label).toBe("Job sources");
    expect(locate("/settings/scoring").tab?.label).toBe("Scoring");
    expect(locate("/settings/data").tab?.label).toBe("Backup & import");
    expect(locate("/settings/about").tab?.label).toBe("About & AI");
  });

  it("job sources: an overview of every source, then each one", async () => {
    mockApi({
      "GET /scanner/status": { supported_boards: [], job_search_enabled: 215, scannable: 152, by_provider: {}, not_scannable: [],
        running: null, last_run: { id: 1, kind: "SCAN", trigger: "manual", status: "COMPLETED", started_at: "2026-10-14T08:00:00Z", finished_at: null, stats: {} },
        settings: { title_include: [], title_broad: [], jd_keywords: [], title_exclude: [], locations: [], location_exclude: [],
          keep_unknown_location: true, max_age_days: 45, max_new_per_company: 50, schedule_hours: 0, search_all_companies: false } },
      "GET /sheets": [{ id: 1, url: "u", title: "Seen Jobs", last_imported_at: "2026-10-15T10:00:00Z", last_result: null, last_error: null }],
      "GET /sheets/access": { service_account: "reader@x.iam.gserviceaccount.com", key_file: "k", error: null },
      "GET /career-ops/status": { configured: false },
    });
    renderAt(<SettingsPage />);
    expect(await screen.findByText("152 companies searched")).toBeInTheDocument();
    expect(await screen.findByText("1 saved · private sheets connected")).toBeInTheDocument();
    expect(await screen.findByText("Not set up (optional)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add Job by hand/ })).toHaveAttribute("href", "/jobs/new");
    expect(screen.getByRole("link", { name: "Download extension (.zip)" })).toHaveAttribute("href", expect.stringContaining("/api/v1/extension.zip?app="));
    expect(screen.getByText("Not installed in this browser.")).toBeInTheDocument();
    // Removed: the one-off sheet import (Google Sheets card does it) and notification options that did nothing.
    expect(screen.queryByText(/Import from Google Sheet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Daily digest/)).not.toBeInTheDocument();
  });

  it("career-ops: runs automatically and shows what it searches", async () => {
    const api = mockApi({
      "GET /scanner/status": { supported_boards: [], job_search_enabled: 0, scannable: 0, by_provider: {}, not_scannable: [], running: null, last_run: null,
        settings: { title_include: [], title_broad: [], jd_keywords: [], title_exclude: [], locations: [], location_exclude: [],
          keep_unknown_location: true, max_age_days: 45, max_new_per_company: 50, schedule_hours: 0, search_all_companies: false } },
      "GET /sheets": [], "GET /sheets/access": { service_account: null, key_file: null, error: null },
      "GET /career-ops/status": { configured: true, scan_enabled: true, node_available: true, code_root: "/x/career-ops", counts: {},
        automation: { schedule_hours: 0, auto_import: false, scan_ready: true, next_scan_at: null } },
      "PATCH /settings/app": {},
      "GET /career-ops/portals": { path: "/x/career-ops/portals.yml", max_posting_age_days: 60, title_keep: ["Magento"], title_skip: ["Intern"],
        locations: ["Pune"], companies: [{ name: "Acme Commerce", careers_url: "https://job-boards.greenhouse.io/acme", enabled: true, notes: null },
          { name: "Old Co", careers_url: null, enabled: false, notes: null }] },
    });
    renderAt(<SettingsPage />);
    const hours = await screen.findByLabelText("Scan + import every (hours, 0 = off)");
    await userEvent.clear(hours);
    await userEvent.type(hours, "24");
    await userEvent.click(screen.getByLabelText(/Import as soon as Career-Ops finds something new/));
    const card = hours.closest("div.rounded-lg") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ career_ops: { schedule_hours: 24, auto_import: true } }));

    await userEvent.click(screen.getByText("What Career-Ops searches"));
    expect(await screen.findByText("Acme Commerce")).toBeInTheDocument();
    expect(screen.getByText("1 on · 1 off")).toBeInTheDocument();
    expect(screen.getByText("Old Co").parentElement).toHaveTextContent("(off)");
  });

  it("scoring: explains each part, saves only real changes, can undo", async () => {
    const api = mockApi({ "GET /settings/scoring": SCORING, "PUT /settings/scoring": SCORING });
    renderAt(<SettingsPage view="scoring" />);
    expect(await screen.findByText("Required skills you have")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // nothing changed yet
    const skills = screen.getByLabelText("Skills weight");
    await userEvent.clear(skills);
    await userEvent.type(skills, "30");
    expect(screen.getByText(/must be 100 to save/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Undo changes" }));
    expect(screen.getByLabelText("Skills weight")).toHaveValue(25);
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("backup & import: downloads and a readable import result", async () => {
    mockApi({ "POST /import/jobs": { created: 3, merged: 1, skipped: 0, errors: [] } });
    renderAt(<SettingsPage view="data" />);
    expect(screen.getByRole("link", { name: "Download full backup (JSON)" })).toHaveAttribute("href", "/api/v1/export/all");
    await userEvent.upload(screen.getByLabelText("Import file"), new File(["title,company\nLead,Acme"], "jobs.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Imported: 3 new, 1 already in the app.")).toBeInTheDocument();
  });

  it("imports a company list (e.g. a Naukri export) into Companies", async () => {
    const api = mockApi({ "POST /companies/import": { created: 2, merged: 5, skipped: 0, errors: [] } });
    renderAt(<SettingsPage view="data" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "What's in the file" }), "companies");
    expect(screen.getByText(/A Naukri company-list export is read as it is/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("Import file"), new File(["Company Name\nAcme"], "naukri.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Imported: 2 new, 5 already in the app.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/companies/import")).toBe(true);
  });

  it("about & AI: turns the Assistant and its AI on or off", async () => {
    const api = mockApi({
      "GET /settings/system": {}, "GET /ai/status": { enabled: true, provider: "anthropic" }, "GET /sheets/access": { service_account: null },
      "GET /chat/status": { enabled: true, use_ai: true, ai_configured: true, mode: "ai", provider: "anthropic", model: "claude" },
      "PATCH /settings/app": {},
    });
    renderAt(<SettingsPage view="about" />);
    await userEvent.click(await screen.findByLabelText(/Use AI in the Assistant/));
    await vi.waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ assistant: { use_ai: false } }));
    await userEvent.click(screen.getByLabelText(/Show the Assistant/));
    await vi.waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ assistant: { enabled: false } }));
  });
});
