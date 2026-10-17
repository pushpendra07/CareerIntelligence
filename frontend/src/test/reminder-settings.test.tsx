import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReminderSettings } from "../features/settings/ReminderSettings";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const RULES = { desktop: false, desktop_available: true, rules: [
  { id: "check-portals", kind: "check_portals", enabled: true, label: "Check job portals", cron: "0 10-20/2 * * 1-6",
    portals: ["LinkedIn", "Naukri"], message: "", only_when_needed: false, schedule: "0 10-20/2 * * 1-6", next_run: "2026-10-19T10:00:00+05:30" },
  { id: "apply", kind: "apply", enabled: false, label: "Apply to shortlisted jobs", cron: "0 11,17 * * 1-5",
    portals: [], message: "", only_when_needed: true, schedule: "0 11,17 * * 1-5", next_run: null },
] };

describe("reminder settings", () => {
  it("turns reminders on, changes how often, adds one, and saves", async () => {
    const api = mockApi({ "GET /reminder-rules": RULES, "PUT /reminder-rules": (_u: URL, init?: RequestInit) => ({ ...RULES, ...JSON.parse(String(init?.body)) }),
      "POST /reminder-rules/check-portals/test": { id: 1, title: "Check job portals", body: "…" } });
    renderAt(<ReminderSettings />);
    expect(await screen.findByText(/Next: /)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save reminders" });
    expect(save).toBeDisabled(); // nothing changed yet

    await userEvent.selectOptions(screen.getByLabelText("Check job portals schedule"), "*/5 * * * *");
    await userEvent.click(screen.getByLabelText("Apply to shortlisted jobs on"));
    await userEvent.selectOptions(screen.getByLabelText("Apply to shortlisted jobs schedule"), "custom");
    const cron = screen.getByLabelText("Apply to shortlisted jobs cron");
    await userEvent.clear(cron);
    await userEvent.type(cron, "*/10 9-18 * * 1-5");
    await userEvent.click(screen.getByLabelText("macOS notifications", { exact: false }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add a reminder" }));
    await userEvent.type(screen.getByLabelText("Message"), "Update my LinkedIn");

    await userEvent.click(save);
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const body = api.calls.find((c) => c.method === "PUT")!.body as { desktop: boolean; rules: Record<string, unknown>[] };
    expect(body.desktop).toBe(true);
    expect(body.rules[0]).toMatchObject({ id: "check-portals", cron: "*/5 * * * *" });
    expect(body.rules[1]).toMatchObject({ id: "apply", enabled: true, cron: "*/10 9-18 * * 1-5" });
    expect(body.rules[2]).toMatchObject({ kind: "custom", enabled: true, message: "Update my LinkedIn" });

    await userEvent.click(screen.getAllByRole("button", { name: "Test now" })[0]);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/reminder-rules/check-portals/test")).toBe(true));
  });
});
