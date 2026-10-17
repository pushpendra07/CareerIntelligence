import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCompanyLines, WelcomePage } from "../features/setup/WelcomePage";
import { mockApi, renderAt } from "./utils";

const STATUS = { needs_setup: true, completed_at: null, steps: { cv: false, targets: false, companies: false, jobs: false },
  counts: { cvs: 0, jobs: 0, scannable_companies: 0 } };
const PREFS = { target_titles: [], preferred_locations: [], required_skills: [], remote_ok: true, hybrid_ok: true, onsite_ok: false,
  min_salary: null, salary_currency: "INR" };

afterEach(() => vi.unstubAllGlobals());

describe("welcome wizard", () => {
  it("reads 'Name | URL' lines", () => {
    expect(parseCompanyLines("https://jobs.lever.co/a\n\n Acme | https://careers.acme.com ")).toEqual([
      { url: "https://jobs.lever.co/a" }, { name: "Acme", url: "https://careers.acme.com" }]);
  });

  it("walks through target roles and companies, then finishes", async () => {
    const calls = mockApi({
      "GET /setup": STATUS,
      "GET /profile": { primary_roles: ["Backend Engineer"], core_skills: ["Python"] },
      "GET /preferences": PREFS,
      "PATCH /preferences": PREFS,
      "GET /scanner/status": { running: null, last_run: null, supported_boards: ["GREENHOUSE", "LEVER"] },
      "POST /setup/companies": [
        { url: "https://boards.greenhouse.io/acme", name: "Acme", company_id: 1, created: true, board: { provider: "GREENHOUSE", url: "x" } },
        { url: "https://acme.example/careers", name: "Other", company_id: 2, created: true, board: null }],
      "POST /setup/complete": { ...STATUS, needs_setup: false },
    });
    renderAt(<WelcomePage />, { path: "*", route: "/welcome" });
    await userEvent.click(await screen.findByRole("button", { name: /Let's start/ }));
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" })); // no CV

    // Titles and skills from the CV are suggested.
    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Locations"), "Pune{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /Save and continue/ }));
    await waitFor(() => expect(calls.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>;
    expect(patch).toMatchObject({ target_titles: ["Backend Engineer"], required_skills: ["Python"], preferred_locations: ["Pune"] });

    await userEvent.type(await screen.findByLabelText(/Careers pages or job boards/), "https://boards.greenhouse.io/acme");
    await userEvent.click(screen.getByRole("button", { name: "Add companies" }));
    const list = await screen.findByRole("list", { name: "Companies added" });
    expect(list).toHaveTextContent("Greenhouse — jobs will be checked");
    expect(list).toHaveTextContent("can't read this site's jobs yet");
    await userEvent.click(screen.getByRole("button", { name: "Next →" }));

    await userEvent.click(await screen.findByRole("button", { name: /Finish and open my dashboard/ }));
    await waitFor(() => expect(calls.calls.some((c) => c.path === "/setup/complete")).toBe(true));
  });
});
