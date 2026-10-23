import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportRulesSettings } from "../features/settings/ImportRulesSettings";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SOURCES = { scan: "Job board search", career_ops: "Career-Ops", sheet: "Google Sheets", import: "CSV / JSON file",
  agent: "AI search & Chrome extension", manual: "Add Job (by hand)" };
const RULES = { enabled: false, required_skills: ["php"], ignored_skills: [], required_roles: [], ignored_roles: [],
  keep_without_description: true, sources: ["scan", "career_ops", "sheet", "import", "agent"] };

describe("import rules settings", () => {
  it("adds and removes skills and roles, picks sources, and saves", async () => {
    const api = mockApi({ "GET /import-rules": { rules: RULES, sources: SOURCES }, "PATCH /settings/app": {} });
    renderAt(<ImportRulesSettings />);
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.click(screen.getByLabelText("Use import rules"));
    await userEvent.type(screen.getByLabelText("Add to Skills a job must have"), "Magento, magento 2, PHP{Enter}");
    await userEvent.type(screen.getByLabelText("Add to Skills to ignore"), "Java");
    await userEvent.click(within(screen.getByLabelText("Add to Skills to ignore").parentElement!).getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Add to Roles to ignore"), "Intern{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Remove php" }));
    await userEvent.click(screen.getByLabelText("Add Job (by hand)"));
    await userEvent.click(save);

    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = api.calls.find((c) => c.method === "PATCH")!.body as { import_rules: typeof RULES };
    expect(body.import_rules).toMatchObject({
      enabled: true, required_skills: ["Magento", "magento 2"], ignored_skills: ["Java"], ignored_roles: ["Intern"],
      sources: ["scan", "career_ops", "sheet", "import", "agent", "manual"],
    });
  });

  it("tests a job against the rules being edited", async () => {
    const api = mockApi({ "GET /import-rules": { rules: RULES, sources: SOURCES },
      "POST /import-rules/check": { saved: false, reason: "ignored skill “java”", found_skills: ["php"], found_ignored_skills: ["java"],
        found_roles: [], found_ignored_roles: [] } });
    renderAt(<ImportRulesSettings />);
    await userEvent.click(await screen.findByText("Test a job against these rules"));
    await userEvent.type(screen.getByLabelText("Job title"), "PHP Developer");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Would not be saved: ignored skill “java”");
    expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Add to Roles to keep"), "Lead{Enter}");
    expect(screen.getByText(/not saved yet/)).toBeInTheDocument();
    const call = api.calls.find((c) => c.path === "/import-rules/check")!;
    expect(call.body).toMatchObject({ title: "PHP Developer", rules: { required_skills: ["php"], enabled: true } });
  });
});
