import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobStatusOptions } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const groupLabels = (label: string) =>
  within(screen.getByRole("group", { name: label })).getAllByRole("option").map((o) => o.textContent);

describe("job status picker", () => {
  it("puts the statuses used most first, then every status", async () => {
    mockApi({ "GET /jobs/status-usage": { CLOSED: 85, NOT_RELEVANT: 75, APPLIED: 62, REJECTED: 7, INTERVIEW: 6, REVIEWING: 4 } });
    renderAt(<select aria-label="Job status"><JobStatusOptions /></select>);
    await vi.waitFor(() => expect(groupLabels("Most used")).toEqual(["Closed", "Not Relevant", "Applied", "Rejected", "Interview"]));
    expect(groupLabels("All statuses")[0]).toBe("Discovered"); // full list keeps pipeline order
  });

  it("falls back to common statuses before there is any history", async () => {
    mockApi({ "GET /jobs/status-usage": {} });
    renderAt(<select aria-label="Job status"><JobStatusOptions /></select>);
    await vi.waitFor(() => expect(groupLabels("Most used")).toEqual(["Applied", "Not Relevant", "Closed", "Rejected", "Interview"]));
  });
});
