import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CVAdvice, CVAdviceSummary } from "../features/cvs/CVAdvice";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const EX = [{ id: 4, title: "Magento Tech Lead", company: "Acme", score: 83 }];
const ADVICE = {
  cv: "Tech Lead – Magento", jobs_considered: 409, hidden: ["PrestaShop"],
  add_to_cv: [{ skill: "AWS", jobs: 4, required: 4, preferred: 0, avg_job_score: 71, examples: EX, in_search: false }],
  missing: [{ skill: "Kubernetes", jobs: 2, required: 2, preferred: 0, avg_job_score: 67.5, examples: EX, in_search: true }],
};

describe("improve your CV", () => {
  it("shows skills to add to the CV and missing skills, with actions", async () => {
    const api = mockApi({
      "GET /cv-advice": ADVICE,
      "POST /cv-advice/skills/add-to-profile": { skill: "Kubernetes", rescored: 437 },
      "POST /cv-advice/skills/add-to-search": { skill: "AWS", rescored: 437 },
      "POST /cv-advice/skills/unhide": { skill: "PrestaShop", rescored: 0 },
    });
    renderAt(<CVAdvice />);
    expect(await screen.findByText("AWS")).toBeInTheDocument();
    expect(screen.getByText(/required in 4 jobs · those jobs score 71 on average/)).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("in job search")).toBeInTheDocument();
    // "I have it" only on missing skills; Kubernetes is already in the job search.
    expect(screen.getAllByRole("button", { name: /I have it/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add to job search" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /I have it/ }));
    expect(api.calls.find((c) => c.path === "/cv-advice/skills/add-to-profile")?.body).toEqual({ skill: "Kubernetes" });
    expect(await screen.findByText(/Kubernetes added to your skills — 437 jobs re-scored/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add to job search" }));
    expect(api.calls.find((c) => c.path === "/cv-advice/skills/add-to-search")?.body).toEqual({ skill: "AWS" });

    await userEvent.click(screen.getAllByRole("button", { name: "Which jobs?" })[0]);
    expect(screen.getAllByRole("link", { name: "Magento Tech Lead" })[0]).toHaveAttribute("href", "/jobs/4");
    await userEvent.click(screen.getByRole("button", { name: "show" }));
    expect(api.calls.some((c) => c.path === "/cv-advice/skills/unhide")).toBe(true);
  });

  it("dashboard summary lists the top skills to add", async () => {
    mockApi({ "GET /cv-advice": ADVICE });
    renderAt(<CVAdviceSummary />);
    expect(await screen.findByText("AWS")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/cvs");
  });
});
