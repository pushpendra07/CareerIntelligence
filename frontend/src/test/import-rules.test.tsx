import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesPage } from "../features/profile/PreferencesPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SOURCES = { scan: "Job board search", career_ops: "Career-Ops", sheet: "Google Sheets", import: "CSV / JSON file",
  agent: "AI search & Chrome extension", manual: "Add Job (by hand)" };
const OFF = { target_titles: false, required_skills: false, excluded_roles: false, excluded_technologies: false };
const RULES = { enabled: false, required_skills: [], ignored_skills: [], required_roles: [], ignored_roles: [],
  keep_without_description: true, sources: ["scan", "career_ops", "sheet", "import", "agent"], extras_enabled: true, from_profile: OFF };
const PREFS = { version: 3, target_titles: ["Senior Magento Developer"], effective_titles: ["Senior Magento Developer"],
  include_architect_roles: false, required_skills: ["Magento"], preferred_skills: [], preferred_domains: [], preferred_companies: [],
  preferred_locations: ["Pune"], remote_ok: true, hybrid_ok: true, onsite_ok: false, min_experience_years: null, max_experience_years: null,
  min_salary: null, target_salary: null, salary_currency: "INR", employment_types: [], notice_period_days: null,
  excluded_roles: ["Intern"], excluded_technologies: [], excluded_industries: [], notes: null };
const ME = { version: 2, updated_at: "2026-10-20T10:00:00Z", full_name: "Asha", headline: null, email: null, phone: null,
  linkedin_url: null, location: null, summary: null, total_experience_years: "12", relevant_experience_years: "10",
  leadership_experience_years: null, primary_roles: ["Magento Developer"], core_skills: ["Magento 2", "PHP"], additional_skills: ["GraphQL"],
  domains: ["eCommerce"], leadership: [], certifications: [], projects: [], achievements: [] };

const routes = (extra: Record<string, unknown> = {}) => ({
  "GET /preferences": PREFS, "GET /profile": ME, "PATCH /profile": ME, "GET /import-rules": { rules: RULES, sources: SOURCES },
  "PATCH /settings/app": {}, "PATCH /preferences": PREFS, ...extra,
});
const open = () => renderAt(<PreferencesPage />, { path: "/preferences", route: "/preferences" });
const row = (name: string) => screen.getByRole("group", { name });

describe("Skills & targets: one job search form", () => {
  it("has one row per item; a Filter switch on titles, must-have skills and both ignore lists", async () => {
    mockApi(routes());
    open();
    const card = await screen.findByRole("region", { name: "Job search" });
    expect([...card.querySelectorAll("[data-row]")].map((g) => g.getAttribute("aria-label"))).toEqual(
      ["Job titles", "Must-have skills", "Nice-to-have skills", "Ignore titles", "Ignore skills", "Where", "Experience & pay"]);
    expect(within(card).getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual(
      ["Filter by Job titles", "Filter by Must-have skills", "Filter by Ignore titles", "Filter by Ignore skills"]);
    expect(within(row("Nice-to-have skills")).getByText("Score only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("switches filters on, adds words and suggestions, and saves everything with one button", async () => {
    const api = mockApi(routes());
    open();
    await userEvent.click(await screen.findByRole("switch", { name: "Filter by Job titles" }));
    await userEvent.click(screen.getByRole("switch", { name: "Filter by Ignore titles" }));
    expect(within(row("Job titles")).getByText("Only fitting titles")).toBeInTheDocument();
    await userEvent.click(within(row("Must-have skills")).getByRole("button", { name: "+ PHP" })); // from your CV
    await userEvent.type(screen.getByRole("textbox", { name: "Ignore skills" }), "Java{Enter}");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search job boards" })).toBeDisabled(); // save first
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    expect(api.calls.find((c) => c.path === "/preferences" && c.method === "PATCH")!.body).toMatchObject({
      required_skills: ["Magento", "PHP"], excluded_technologies: ["Java"] });
    expect((api.calls.find((c) => c.path === "/settings/app")!.body as { import_rules: typeof RULES }).import_rules).toMatchObject({
      enabled: true, from_profile: { ...OFF, target_titles: true, excluded_roles: true } });
    expect(api.calls.some((c) => c.path === "/profile" && c.method === "PATCH")).toBe(false); // only what changed
  });

  it("moves the old Import rules words into the matching lists, with Filter on", async () => {
    const api = mockApi(routes({ "GET /import-rules": { sources: SOURCES, rules: { ...RULES, enabled: true,
      ignored_skills: ["Java"], ignored_roles: ["Intern", "Sales"] } } }));
    open();
    expect(await screen.findByText(/Your 3 words from the old/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Filter by Ignore skills" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Filter by Ignore titles" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/settings/app")).toBe(true));
    expect(api.calls.find((c) => c.path === "/preferences" && c.method === "PATCH")!.body).toMatchObject({
      excluded_roles: ["Intern", "Sales"], excluded_technologies: ["Java"] });
    expect((api.calls.find((c) => c.path === "/settings/app")!.body as { import_rules: typeof RULES }).import_rules).toMatchObject({
      ignored_skills: [], ignored_roles: [], from_profile: { ...OFF, excluded_roles: true, excluded_technologies: true } });
  });

  it("suggests words learned from the jobs you went for and turned down", async () => {
    const api = mockApi(routes({ "GET /preferences/suggestions": {
      based_on: { went_for: 12, turned_down: 30 },
      target_titles: [{ value: "Magento Developer", count: 9 }], required_skills: [{ value: "GraphQL", count: 6 }],
      excluded_roles: [{ value: "Sales", count: 11 }], excluded_technologies: [{ value: "Java", count: 14 }, { value: "PHP", count: 5 }] } }));
    open();
    expect(await screen.findByText(/12 you went for, 30 you marked Not relevant or Ignored/)).toBeInTheDocument();
    const java = within(row("Ignore skills")).getByRole("button", { name: "+ Java 14" });
    expect(java).toHaveAttribute("title", expect.stringContaining("14 jobs you marked Not relevant"));
    expect(within(row("Ignore skills")).queryByRole("button", { name: /\+ PHP/ })).not.toBeInTheDocument(); // a core skill of yours
    expect(within(row("Ignore titles")).getByRole("button", { name: "+ Sales 11" })).toBeInTheDocument();
    expect(within(row("Must-have skills")).getByRole("button", { name: "+ GraphQL 6" })).toBeInTheDocument();
    await userEvent.click(java);
    await userEvent.click(within(row("Job titles")).getByRole("button", { name: "+ Magento Developer 9" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/preferences" && c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.path === "/preferences" && c.method === "PATCH")!.body).toMatchObject({
      excluded_technologies: ["Java"], target_titles: ["Senior Magento Developer", "Magento Developer"] });
  });

  it("starts a job board search", async () => {
    const api = mockApi(routes({ "POST /scanner/run": { id: 1 } }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Search job boards" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/scanner/run")).toBe(true));
    expect(screen.getByRole("link", { name: "Search portals" })).toHaveAttribute("href", "/jobs/ai-search");
  });

  it("previews what the filters would block, using the lists as edited", async () => {
    const api = mockApi(routes({ "POST /import-rules/impact": { checked: 40, blocked: 6, high_scoring_blocked: 2,
      reasons: [{ reason: "excluded technology “Java” (target profile)", count: 6 }],
      examples: [{ id: 9, title: "Java Lead", score: 81, reason: "excluded technology “Java” (target profile)" }] } }));
    open();
    await userEvent.type(await screen.findByRole("textbox", { name: "Ignore skills" }), "Java{Enter}");
    await userEvent.click(screen.getByRole("switch", { name: "Filter by Ignore skills" }));
    await userEvent.click(screen.getByRole("button", { name: "Check my open jobs" }));
    expect(await screen.findByText(/would not have been saved/)).toHaveTextContent(
      "Of your 40 open jobs, 6 would not have been saved, including 2 scoring 70+.");
    expect(screen.getByRole("link", { name: "Java Lead" })).toHaveAttribute("href", "/jobs/9");
    expect(api.calls.find((c) => c.path === "/import-rules/impact")!.body).toMatchObject({
      rules: { from_profile: { excluded_technologies: true } }, profile: { excluded_technologies: ["Java"] } });
  });

  it("tests one job against the filters", async () => {
    const api = mockApi(routes({ "POST /import-rules/check": { saved: false, reason: "excluded role “Intern” (target profile)",
      found_skills: [], found_ignored_skills: [], found_roles: [], found_ignored_roles: ["Intern"] } }));
    open();
    await userEvent.click(await screen.findByText("Test a job against these filters"));
    await userEvent.type(screen.getByLabelText("Job title"), "PHP Intern");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/Would not be saved: excluded role/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/import-rules/check")!.body).toMatchObject({ title: "PHP Intern", profile: { excluded_roles: ["Intern"] } });
  });

  it("edits what you bring from your CV, saved with the same button", async () => {
    const api = mockApi(routes());
    open();
    await userEvent.click(await screen.findByText("From your CV"));
    await userEvent.type(screen.getByLabelText("Core skills"), "Hyvä{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/profile" && c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.path === "/profile" && c.method === "PATCH")!.body).toMatchObject({ core_skills: ["Magento 2", "PHP", "Hyvä"] });
    expect(api.calls.filter((c) => c.method === "PATCH").map((c) => c.path)).toEqual(["/profile"]);
  });

  it("still opens when the API hasn't been restarted since the update", async () => {
    const { from_profile: _f, extras_enabled: _x, ...oldRules } = RULES; // eslint-disable-line @typescript-eslint/no-unused-vars
    void _f; void _x;
    mockApi(routes({ "GET /import-rules": { rules: oldRules, sources: SOURCES } }));
    open();
    expect(await screen.findByRole("switch", { name: "Filter by Job titles" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
