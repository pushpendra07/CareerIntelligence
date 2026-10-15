import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostingCheck, postingAge } from "../features/jobs/PostingCheck";
import type { JobDetail } from "../types/api";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 7, title: "Magento Lead", status: "NEW", posting_date: "2017-03-01", source_url: "https://jobs.acme.example/7",
  source_links: [], posting_check: null } as unknown as JobDetail;

describe("posting check", () => {
  it("flags old postings", () => {
    const today = new Date("2026-10-15T12:00:00");
    expect(postingAge("2017-03-01", today)).toBe("Posted 9 years ago");
    expect(postingAge("2026-06-01", today)).toBe("Posted 4 months ago");
    expect(postingAge("2026-10-01", today)).toBeNull();
    expect(postingAge(null, today)).toBeNull();
  });

  it("checks the posting and offers to close it", async () => {
    const api = mockApi({ "POST /jobs/7/check-posting": { ...JOB, posting_check: { state: "CLOSED" } } });
    const onMarkClosed = vi.fn();
    const closed = { ...JOB, posting_check: { state: "CLOSED", reason: "Greenhouse says this posting no longer exists",
      url: JOB.source_url!, valid_through: null, checked_at: "2026-10-15T10:00:00Z" } } as JobDetail;
    const { unmount } = renderAt(<PostingCheck job={JOB} onMarkClosed={onMarkClosed} busy={false} />);
    expect(screen.getByText("Posted 9 years ago")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check if still open" }));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /jobs/7/check-posting");

    unmount();
    renderAt(<PostingCheck job={closed} onMarkClosed={onMarkClosed} busy={false} />);
    expect(screen.getByText(/Greenhouse says this posting no longer exists/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark as closed" }));
    expect(onMarkClosed).toHaveBeenCalled();
  });

  it("says when there is no link to check", () => {
    renderAt(<PostingCheck job={{ ...JOB, source_url: null }} onMarkClosed={() => {}} busy={false} />);
    expect(screen.getByText("No posting link to check")).toBeInTheDocument();
  });
});
