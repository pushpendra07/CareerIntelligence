import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecruitersPage } from "../features/recruiters/RecruitersPage";
import { mockApi, renderAt } from "./utils";

const CONTACT = {
  id: 1, name: "Asha Verma", company_id: 2, company_name: "TalentCo", job_title: null, contact_type: "RECRUITER",
  linkedin_url: null, email: "asha.verma@talentco.example.in", phone: "+91 98765 43210", source: "Job #421 notes",
  location: null, notes: null, status: "NOT_CONTACTED", last_contacted_at: null, next_followup_at: null,
  jobs: [{ id: 421, title: "Magento Developer", status: "NEW" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("RecruitersPage", () => {
  it("shows phone with call and WhatsApp links, where it was found, and the linked job", async () => {
    mockApi({ "GET /recruiters": { items: [CONTACT], total: 1, page: 1, size: 10 } });
    renderAt(<RecruitersPage />, { path: "/recruiters", route: "/recruiters" });
    expect(await screen.findByRole("link", { name: "+91 98765 43210" })).toHaveAttribute("href", "tel:+919876543210");
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/919876543210");
    expect(screen.getByText("From Job #421 notes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Magento Developer" })).toHaveAttribute("href", "/jobs/421");
  });

  it("finds contacts in jobs and reports what it did", async () => {
    const api = mockApi({
      "GET /recruiters": { items: [], total: 0, page: 1, size: 10 },
      "POST /recruiters/find-in-jobs": { jobs_checked: 614, jobs_with_new_contacts: 5, created: 6, updated: 0, linked: 5 },
    });
    renderAt(<RecruitersPage />, { path: "/recruiters", route: "/recruiters" });
    fireEvent.click(screen.getByRole("button", { name: "Find contacts in jobs" }));
    expect(await screen.findByText("Checked 614 jobs: 6 new contacts, 0 updated, 5 linked to a job.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/recruiters/find-in-jobs")).toBe(true);
  });
});
