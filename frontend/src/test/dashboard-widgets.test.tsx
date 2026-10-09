import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BestMatches, GettingStarted } from "../features/dashboard/widgets";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 9, title: "Magento Tech Lead", status: "NEW", match_score: 88, score_stale: false, jd_status: "MISSING",
  company: { id: 1, name: "Acme", tier: null }, location: "Pune", work_model: "HYBRID", sources: ["LINKEDIN"] };

describe("dashboard widgets", () => {
  it("best matches: lists top new jobs and shortlists in one click", async () => {
    const api = mockApi({
      "GET /jobs": { items: [JOB], total: 17, page: 1, size: 8 },
      "POST /jobs/9/status": { id: 9, status: "SHORTLISTED" },
    });
    renderAt(<BestMatches />);
    expect(await screen.findByRole("link", { name: "Magento Tech Lead" })).toHaveAttribute("href", "/jobs/9");
    expect(screen.getByText("no description")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all (17)" })).toBeInTheDocument();
    const list = new URL(String(api.fn.mock.calls[0][0]), "http://x");
    expect(list.searchParams.getAll("status")).toEqual(["NEW", "DISCOVERED"]);
    expect(list.searchParams.get("min_score")).toBe("70");
    expect(list.searchParams.get("has_application")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: /Shortlist/ }));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ status: "SHORTLISTED" });
  });

  it("getting started: shows what's left and hides when done", async () => {
    mockApi({
      "GET /cvs": { items: [], total: 1, page: 1, size: 1 },
      "GET /profile": { core_skills: ["Magento"], total_experience_years: 12 },
      "GET /preferences": { target_titles: ["Tech Lead"], target_salary: null, min_salary: null },
      "GET /scanner/status": { scannable: 36, running: null, last_run: null },
    });
    renderAt(<GettingStarted totalJobs={400} />);
    expect(await screen.findByText("Getting started — 5 of 6 done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Set your salary target/ })).toHaveAttribute("href", "/preferences");
  });
});
