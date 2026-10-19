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

describe("copy job link", () => {
  it("copies the posting link and says so", async () => {
    const { render, screen } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { CopyLinkButton } = await import("../components/ui");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLinkButton url="https://www.linkedin.com/jobs/view/4100000099/" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy job link" }));
    expect(writeText).toHaveBeenCalledWith("https://www.linkedin.com/jobs/view/4100000099/");
    expect(await screen.findByText("Copied ✓")).toBeInTheDocument();
  });
});
