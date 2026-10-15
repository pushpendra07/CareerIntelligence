import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceTimeline, sourceTimeline } from "../features/jobs/JobParts";
import type { JobDetail } from "../types/api";

const link = (extra: object) => ({ id: 1, source: "INDEED", original_url: null, normalized_url: null, external_id: null, detail: null,
  first_seen_at: "2026-10-09T11:11:00Z", last_seen_at: "2026-10-09T11:11:00Z", ...extra });

const job = (extra: object) => ({ posting_date: "2026-10-08", created_at: "2026-10-09T11:11:00Z", source_links: [], ...extra }) as unknown as JobDetail;

describe("where a job came from", () => {
  it("orders posted → added to the sheet → added to the app → seen again", () => {
    const { events, missing } = sourceTimeline(job({ source_links: [
      link({ imported: { source: "Seen Jobs · Seen Jobs (Claude Sheet)", added_to_sheet: "2026-10-09", posted_text: "2026-10-08" },
        last_seen_at: "2026-10-15T18:00:00Z" }),
      link({ id: 2, source: "GREENHOUSE", detail: "scanner", first_seen_at: "2026-10-12T08:00:00Z", last_seen_at: "2026-10-12T08:00:00Z" }),
    ] }));
    expect(events.map((e) => e.label)).toEqual([
      "Posted on the job site",
      "Added to sheet “Seen Jobs · Seen Jobs (Claude Sheet)”",
      "Added to this app",
      "Also found in Greenhouse · scanner",
      "Last seen in sheet “Seen Jobs · Seen Jobs (Claude Sheet)”",
    ]);
    expect(events[2].note).toBe("from sheet “Seen Jobs · Seen Jobs (Claude Sheet)”");
    expect(missing).toEqual([]);
  });

  it("says what the sheet doesn't tell", () => {
    const { events, missing } = sourceTimeline(job({ posting_date: null,
      source_links: [link({ imported: { source: "Job Tracker · Job Tracker", posted_text: "2 days ago" } })] }));
    expect(events.map((e) => e.label)).toEqual(["Added to this app"]);
    expect(missing).toEqual([
      "Posted date unknown (sheet says “2 days ago”)",
      "Date added to sheet “Job Tracker · Job Tracker”: the sheet has no date column",
    ]);
    render(<SourceTimeline job={job({ posting_date: null, source_links: [link({ imported: { source: "T", posted_text: "2 days ago" } })] })} />);
    expect(screen.getByText("Added to this app")).toBeInTheDocument();
    expect(screen.getByText(/the sheet has no date column/)).toBeInTheDocument();
  });
});
