import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewPage } from "../features/jobs/ReviewPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const job = (id: number, title: string, score: number) => ({
  id, title, status: "NEW", match_score: score, score_stale: false, jd_status: "OK",
  company: { id: 1, name: "Acme", tier: "A" }, location: "Jaipur", work_model: "REMOTE", experience_min: "8",
  experience_max: null, salary_min: null, salary_max: null, salary_currency: null, salary_text: null,
  posting_date: "2026-10-01", source_url: `https://acme.example/jobs/${id}`, source_links: [],
  original_jd: "Lead our Magento team.", recommendation: "RECOMMENDED",
  match: {
    score, recommendation: "RECOMMENDED", confidence: "HIGH", strong_matches: ["Magento"], missing: ["Python"], blockers: [],
    components: [
      { key: "role", label: "Role", weight: 20, factor: 1, points: 20, reasons: ["Title matches your target roles"] },
      { key: "skills", label: "Skills", weight: 25, factor: 0.3, points: 7.5, reasons: ["1 of 3 required skills"] },
    ],
  },
});

const A = job(1, "Magento Lead", 88);
const B = job(2, "PHP Architect", 75);

function setup(statusPosts: { id: string; status: string }[]) {
  let items = [A, B];
  return mockApi({
    "GET /jobs": () => ({ items, total: items.length, page: 1, size: 50 }),
    "GET /jobs/1": A,
    "GET /jobs/2": B,
    "POST /jobs/1/status": (_url: URL, init?: RequestInit) => {
      const { status } = JSON.parse(String(init?.body));
      statusPosts.push({ id: "1", status });
      items = status === "NEW" ? [A, B] : [B];
      return { ok: true };
    },
    "POST /jobs/2/status": (_url: URL, init?: RequestInit) => {
      statusPosts.push({ id: "2", status: JSON.parse(String(init?.body)).status });
      items = items.filter((j) => j.id !== 2);
      return { ok: true };
    },
  });
}

describe("quick review", () => {
  it("shows the best match with reasons, and moves on after a decision", async () => {
    const posts: { id: string; status: string }[] = [];
    const api = setup(posts);
    renderAt(<ReviewPage />, { path: "/jobs/review", route: "/jobs/review" });

    expect(await screen.findByRole("heading", { name: "Magento Lead" })).toBeInTheDocument();
    expect(screen.getByText("✓ Title matches your target roles")).toBeInTheDocument();
    expect(screen.getByText("– 1 of 3 required skills")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // left to review
    const list = api.calls.find((c) => c.path === "/jobs");
    expect(list).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Shortlist/ }));
    expect(await screen.findByRole("heading", { name: "PHP Architect" })).toBeInTheDocument();
    expect(posts).toEqual([{ id: "1", status: "SHORTLISTED" }]);

    // Undo puts the job back to its old status.
    await userEvent.keyboard("u");
    expect(await screen.findByRole("heading", { name: "Magento Lead" })).toBeInTheDocument();
    expect(posts.at(-1)).toEqual({ id: "1", status: "NEW" });
  });

  it("supports keyboard shortcuts and skip", async () => {
    const posts: { id: string; status: string }[] = [];
    setup(posts);
    renderAt(<ReviewPage />, { path: "/jobs/review", route: "/jobs/review" });
    await screen.findByRole("heading", { name: "Magento Lead" });

    await userEvent.keyboard("k"); // skip: nothing is saved
    expect(await screen.findByRole("heading", { name: "PHP Architect" })).toBeInTheDocument();
    expect(posts).toEqual([]);

    await userEvent.keyboard("n");
    expect(await screen.findByText("You've seen every job in this list")).toBeInTheDocument();
    expect(posts).toEqual([{ id: "2", status: "NOT_RELEVANT" }]);
    expect(screen.getByRole("button", { name: "Review skipped again" })).toBeInTheDocument();
  });
});
