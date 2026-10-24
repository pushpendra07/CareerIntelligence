import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRoadmapPage, type Roadmap } from "../features/profile/SkillRoadmapPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const EX = [{ id: 4, title: "Laravel Lead", company: "Acme", before: 76, after: 82 }];
const ROADMAP: Roadmap = {
  threshold: 80, strong_threshold: 70, jobs_considered: 206, good_now: 78, strong_now: 147, hidden: ["PrestaShop"],
  skills: [
    { skill: "Laravel", required: 27, preferred: 0, jobs: 27, strong_share: 14, new_good: 9, jobs_raised: 29, avg_gain: 4.5, close_to: "PHP", in_search: false, examples: EX },
    { skill: "Unit Testing", required: 7, preferred: 2, jobs: 9, strong_share: 6, new_good: 0, jobs_raised: 9, avg_gain: 2, close_to: null, in_search: true, examples: [] },
  ],
  roadmap: [
    { step: 1, skill: "Laravel", new_good: 9, jobs_raised: 29, total_good: 87, examples: EX },
    { step: 2, skill: "Unit Testing", new_good: 0, jobs_raised: 9, total_good: 87, examples: [] },
  ],
};

describe("skill roadmap", () => {
  it("shows the learning path, what each skill is worth, and the actions", async () => {
    const api = mockApi({ "GET /cv-advice/roadmap": ROADMAP, "POST /cv-advice/skills/add-to-profile": { skill: "Laravel", rescored: 12 },
      "POST /cv-advice/skills/unhide": { skill: "PrestaShop", rescored: 0 } });
    renderAt(<SkillRoadmapPage />);
    const path = await screen.findByRole("list", { name: "Learning path" });
    expect(path).toHaveTextContent("Today");
    expect(path).toHaveTextContent("+9 good jobs · raises 29 jobs · you know PHP");
    expect(path).toHaveTextContent("no new good jobs");
    expect(within(path).getByRole("link", { name: "Laravel Lead" })).toHaveAttribute("href", "/jobs/4");
    expect(screen.getByText("87 (+9)")).toBeInTheDocument(); // good matches after the path
    const row = screen.getByRole("row", { name: /Laravel/ });
    expect(row).toHaveTextContent("27 required");
    expect(row).toHaveTextContent("14%");
    expect(row).toHaveTextContent("+4.5");
    await userEvent.click(within(row).getByRole("button", { name: "I have it" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/cv-advice/skills/add-to-profile")?.body).toEqual({ skill: "Laravel" }));
    await userEvent.click(screen.getByRole("button", { name: "show" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/cv-advice/skills/unhide")).toBe(true));
  });

  it("says so when no skill would help", async () => {
    mockApi({ "GET /cv-advice/roadmap": { ...ROADMAP, skills: [], roadmap: [], hidden: [] } });
    renderAt(<SkillRoadmapPage />);
    expect(await screen.findByText(/No missing skill would raise a job's score/)).toBeInTheDocument();
    expect(screen.getByText(/Your open jobs don't ask for skills you lack/)).toBeInTheDocument();
  });
});
