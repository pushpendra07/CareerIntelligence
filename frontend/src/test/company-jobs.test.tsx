import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyJobs } from "../features/companies/CompanyJobs";
import { CompaniesPage } from "../features/companies/CompaniesPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 5, title: "Magento Lead", status: "APPLIED", match_score: 86, score_stale: false, jd_status: "OK",
  company: { id: 3, name: "Acme", tier: null }, location: "Pune", work_model: "HYBRID", sources: ["LINKEDIN"],
  added_via: ["sheet"], posting_date: "2026-10-01" };

describe("company jobs", () => {
  it("lists the company's jobs from the app, open only by default", async () => {
    const api = mockApi({ "GET /jobs": { items: [JOB], total: 1, page: 1, size: 10 } });
    renderAt(<CompanyJobs companyId={3} companyName="Acme" total={4} open={1} onScan={() => {}} scanning={false} />);
    expect(await screen.findByRole("link", { name: "Magento Lead" })).toHaveAttribute("href", "/jobs/5");
    expect(screen.getByText("Jobs in Career Intelligence (1 open · 4 total)")).toBeInTheDocument();
    expect(screen.getByTitle("Added via Google Sheet")).toBeInTheDocument();
    const url = new URL(String(api.fn.mock.calls[0][0]), "http://x");
    expect(url.searchParams.get("company_id")).toBe("3");
    expect(url.searchParams.getAll("status")).not.toContain("CLOSED");
    await userEvent.click(screen.getByLabelText("Open only"));
    const all = new URL(String(api.fn.mock.calls.at(-1)![0]), "http://x");
    expect(all.searchParams.getAll("status")).toEqual([]);
  });

  it("offers to scan or add a job when the company has none", async () => {
    const onScan = vi.fn();
    mockApi({ "GET /jobs": { items: [], total: 0, page: 1, size: 10 } });
    renderAt(<CompanyJobs companyId={3} companyName="Acme" total={0} open={0} onScan={onScan} scanning={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Scan its job board" }));
    expect(onScan).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Add a job by hand" })).toHaveAttribute("href", "/jobs/new");
  });

  it("companies list shows open/total jobs and filters companies with jobs", async () => {
    const api = mockApi({
      "GET /companies": { items: [{ id: 3, name: "Acme", tier: null, verification_status: "VERIFIED", verification_score: 80,
        india_presence: true, india_locations: ["Pune"], careers_url: null, ats_provider: null, hiring_status: "UNKNOWN",
        job_search_enabled: true, company_type: null, industry: null, job_count: 4, open_job_count: 1 }], total: 1, page: 1, size: 10 },
      "GET /companies/stats": {},
    });
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    expect(await screen.findByTitle("1 open · 4 in total")).toHaveAttribute("href", "/companies/3#jobs");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Jobs in app" }), "true");
    const last = new URL(String(api.fn.mock.calls.filter((c) => String(c[0]).includes("/companies?")).at(-1)![0]), "http://x");
    expect(last.searchParams.get("has_jobs")).toBe("true");
  });
});

describe("company id", () => {
  it("shows the company ID and sorts by it", async () => {
    const api = mockApi({
      "GET /companies": { items: [{ id: 3, name: "Acme", tier: null, verification_status: "VERIFIED", verification_score: 80,
        india_presence: null, india_locations: [], careers_url: null, ats_provider: null, hiring_status: "UNKNOWN",
        job_search_enabled: false, company_type: null, industry: null, job_count: 0, open_job_count: 0 }], total: 1, page: 1, size: 10 },
      "GET /companies/stats": {},
    });
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    expect(await screen.findByTitle("Company ID")).toHaveTextContent("#3");
    await userEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    const last = new URL(String(api.fn.mock.calls.filter((c) => String(c[0]).includes("/companies?")).at(-1)![0]), "http://x");
    expect(last.searchParams.get("sort")).toBe("-id");
  });
});
