import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiJobSearchSettings } from "../features/settings/AiJobSearchSettings";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const STATUS = {
  configured: true, path: "/x/ai-job-search", available: true, version: "1.2.7", error: null,
  counts: { seen: 40, new: 12, ranked: 20, skipped: 8, tracker: 5 }, running: false, auto_import: false,
  changed_since_import: true,
  last_import: { started_at: "2026-10-22T08:00:00Z", finished_at: "2026-10-22T08:00:05Z", errors: [],
    stats: { created: 9, merged: 23, applications: 5, vetoed: 2 } },
};

describe("AI Job Search source", () => {
  it("shows what its files hold, imports, and turns on automatic import", async () => {
    const api = mockApi({
      "GET /ai-job-search/status": STATUS,
      "POST /ai-job-search/import": STATUS.last_import,
      "PUT /ai-job-search/settings": { auto_import: true },
    });
    renderAt(<AiJobSearchSettings />);
    expect(await screen.findByText("40 (12 new, 20 ranked, 8 skipped)")).toBeInTheDocument();
    expect(screen.getByText(/its files changed since/)).toBeInTheDocument();
    expect(screen.getByText(/9 new, 23 already in your list \(merged\), 5 applications/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See these jobs" })).toHaveAttribute("href", "/jobs?added_via=ai_job_search");

    await userEvent.click(screen.getByRole("button", { name: "Import now" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Import as soon as AI Job Search finds something new/ }));
    await vi.waitFor(() => expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      expect.arrayContaining(["POST /ai-job-search/import", "PUT /ai-job-search/settings"])));
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ auto_import: true });
  });

  it("says how to set it up when it isn't", async () => {
    mockApi({ "GET /ai-job-search/status": { ...STATUS, configured: false, path: null, available: false, counts: null, last_import: null, version: null } });
    renderAt(<AiJobSearchSettings />);
    expect(await screen.findByText("Not set up — run ./scripts/setup-ai-job-search.sh")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import now" })).toBeDisabled();
  });
});
