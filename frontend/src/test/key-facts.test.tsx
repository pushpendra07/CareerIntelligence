import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyFacts } from "../features/jobs/JobParts";
import type { JobDetail } from "../types/api";
import { formatDate } from "../utils/format";

const link = (extra: object) => ({ id: 1, source: "INDEED", original_url: null, normalized_url: null, external_id: null, detail: null,
  first_seen_at: "2026-10-09T11:11:00Z", last_seen_at: "2026-10-09T11:11:00Z", ...extra });

const job = (extra: object) => ({ posting_date: "2026-10-08", created_at: "2026-10-09T11:11:00Z", source_links: [], ...extra }) as unknown as JobDetail;

describe("job dates in key facts", () => {
  it("key facts show the dates in order: posted, added to sheet, added here", () => {
    const base = { location: "Remote", locations: [], work_model: "REMOTE", experience_min: null, experience_max: null,
      salary_text: null, salary_min: null, salary_max: null, salary_currency: null };
    const { container, unmount } = render(<KeyFacts job={job({ ...base, source_links: [link({ imported: { source: "S", added_to_sheet: "2026-10-12" } })] })} />);
    const labels = [...container.querySelectorAll("dt")].map((d) => d.textContent);
    expect(labels.slice(-3)).toEqual(["Posted on job site", "Added to sheet", "Added to this app"]);
    expect(screen.getByText(formatDate("2026-10-12"))).toBeInTheDocument();
    unmount();

    render(<KeyFacts job={job({ ...base, posting_date: null, source_links: [link({ imported: { source: "S", posted_text: "Active Opening" } })] })} />);
    expect(screen.getByText("“Active Opening” (sheet)")).toBeInTheDocument();
    expect(screen.getByText("— (no date in sheet)")).toBeInTheDocument();
  });

  it("jobs not from a sheet keep the short row", () => {
    const { container } = render(<KeyFacts job={job({ location: null, locations: [], work_model: "UNKNOWN", experience_min: null,
      experience_max: null, salary_text: null, salary_min: null, salary_max: null, salary_currency: null })} />);
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).not.toContain("Added to sheet");
  });
});
