import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { JobSkills, JobsPage } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

describe("skills in the jobs list", () => {
  it("shows required skills first, then preferred ones, and counts the rest", () => {
    renderAt(<JobSkills max={3} job={{ required_skills: ["Magento 2", "PHP"], preferred_skills: ["PHP", "GraphQL", "AWS", "Redis"] }} />);
    const list = screen.getByRole("list", { name: "Skills" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["Magento 2", "PHP", "GraphQL", "+2"]);
    expect(within(items[0]).getByText("Magento 2")).toHaveAttribute("title", "Required");
    expect(within(items[2]).getByText("GraphQL")).toHaveAttribute("title", "Preferred");
    expect(items[3]).toHaveAttribute("title", "AWS, Redis");
  });

  it("shows nothing for a job without skills", () => {
    renderAt(<JobSkills job={{ required_skills: [], preferred_skills: [] }} />);
    expect(screen.queryByRole("list", { name: "Skills" })).not.toBeInTheDocument();
  });

  it("clicking a skill filters the list by it; clicking it again clears the filter", async () => {
    const job = { id: 1, title: "Magento Lead", status: "NEW", match_score: 80, score_stale: false, jd_status: "OK",
      company: { id: 1, name: "Acme", tier: null }, location: null, work_model: "UNKNOWN", experience_min: null,
      experience_max: null, salary_min: null, salary_max: null, salary_currency: null, sources: [], posting_date: null,
      required_skills: ["Magento 2", "PHP"], preferred_skills: [] };
    const api = mockApi({ "GET /jobs": { items: [job], total: 1, page: 1, size: 50 }, "GET /jobs/status-counts": {} });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?tab=new" });
    const lastList = () => new URL(String(api.fn.mock.calls.map((c: unknown[]) => c[0]).filter((u: unknown) =>
      String(u).includes("/jobs?")).at(-1)), "http://x");
    await userEvent.click(await screen.findByRole("button", { name: "PHP" }));
    expect(lastList().searchParams.get("technology")).toBe("PHP");
    expect(await screen.findByRole("button", { name: "PHP", pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "PHP" }));
    expect(lastList().searchParams.get("technology")).toBeNull();
  });
});
