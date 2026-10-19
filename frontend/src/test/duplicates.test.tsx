import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DuplicatesPage } from "../features/jobs/DuplicatesPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const job = (id: number, location: string, status: string) => ({
  id, title: "Packaged/SaaS App Engineering Lead", status, location, posting_date: "2026-10-09",
  company: { id: 1, name: "Accenture", tier: "A" },
});

describe("duplicate jobs", () => {
  it("lists groups with the kept job first and merges them", async () => {
    let groups = [[job(512, "Gurugram", "APPLIED"), job(624, "Pune", "NEW")]];
    const api = mockApi({
      "GET /jobs/duplicates": () => ({ groups, extra_jobs: groups.length }),
      "POST /jobs/duplicates/merge": () => { groups = []; return { groups: 1, jobs_removed: 1, merged: [] }; },
    });
    renderAt(<DuplicatesPage />, { path: "/jobs/duplicates", route: "/jobs/duplicates" });
    expect(await screen.findByText("Accenture · Packaged/SaaS App Engineering Lead")).toBeInTheDocument();
    expect(screen.getByText("kept")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Merge 2 into #512" }));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ keep_ids: [512] });
    expect(await screen.findByText(/No duplicate jobs/)).toBeInTheDocument();
  });
});
