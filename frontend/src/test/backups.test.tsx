import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupSettings, type BackupStatus } from "../features/settings/BackupSettings";
import { mockApi, renderAt } from "./utils";

const STATUS: BackupStatus = {
  settings: { enabled: true, every_hours: 24, keep: 14 }, folder: "/app/backend/backups", pg_dump: true,
  last: "2026-10-17T03:30:00Z", next_due: "2026-10-18T03:30:00Z", running: false,
  backups: [{ name: "career-backup-20261017-090000.zip", size: 2_400_000, created_at: "2026-10-17T03:30:00Z", trigger: "schedule", database_dump: true, note: null, files: 3, rows: 1500 }],
};

afterEach(() => vi.unstubAllGlobals());

describe("BackupSettings", () => {
  it("lists backups with a download link and backs up now", async () => {
    const api = mockApi({ "GET /backups": STATUS, "POST /backups": STATUS.backups[0] });
    renderAt(<BackupSettings />);
    expect(await screen.findByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/v1/backups/career-backup-20261017-090000.zip");
    expect(screen.getByText(/database · 1500 rows · 3 files/)).toBeInTheDocument();
    expect(screen.getByText("2.3 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/backups")).toBe(true));
  });

  it("changes the schedule and warns without pg_dump", async () => {
    const api = mockApi({ "GET /backups": { ...STATUS, pg_dump: false }, "PATCH /settings/app": {} });
    renderAt(<BackupSettings />);
    expect(await screen.findByText(/pg_dump isn't installed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Backup every"), { target: { value: "12" } });
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ backups: { every_hours: 12 } }));
  });
});
