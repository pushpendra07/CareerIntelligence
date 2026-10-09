import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedSheetsSettings } from "../features/sheets/SavedSheetsSettings";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SHEET = { id: 1, url: "https://docs.google.com/spreadsheets/d/abc/edit", title: "Seen Jobs", spreadsheet_id: "abc",
  created_at: "2026-10-09T10:00:00Z", last_imported_at: "2026-10-09T10:30:00Z", last_error: null,
  last_result: { via: "connector", created: 11, merged: 0, tabs: [{ tab: "Seen Jobs", kind: "jobs", created: 11, merged: 0 }] } };
const PRIVATE = "This sheet is private, so the app can't open it. Ask Claude to import it.";

describe("saved Google Sheets", () => {
  it("lists sheets with their last import, imports on click and explains private sheets", async () => {
    const api = mockApi({
      "GET /sheets": [SHEET],
      "POST /sheets/1/import": new Response(JSON.stringify({ error: { code: "conflict", message: PRIVATE } }), { status: 409, headers: { "content-type": "application/json" } }),
      "POST /sheets": { ...SHEET, id: 2 },
    });
    renderAt(<SavedSheetsSettings />);
    expect(await screen.findByRole("link", { name: "Seen Jobs" })).toHaveAttribute("href", SHEET.url);
    expect(screen.getByText(/by Claude, via Google Drive/)).toBeInTheDocument();
    expect(screen.getByText("11 new")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText(PRIVATE)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/sheets/1/import")).toBe(true);

    await userEvent.type(screen.getByLabelText("Sheet URL"), "https://docs.google.com/spreadsheets/d/xyz/edit");
    await userEvent.click(screen.getByRole("button", { name: "Save sheet" }));
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/sheets")?.body)
      .toEqual({ url: "https://docs.google.com/spreadsheets/d/xyz/edit", title: null });
  });
});
