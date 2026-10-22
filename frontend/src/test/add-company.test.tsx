import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddCompanyPage, companyBody } from "../features/companies/AddCompanyPage";
import { CompaniesPage } from "../features/companies/CompaniesPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SIMILAR = { id: 3, name: "Acme Corp", website: "https://www.acme.com", verification_status: "VERIFIED" };

describe("add company page", () => {
  it("saves every filled detail and leaves empty ones out", async () => {
    const api = mockApi({
      "GET /companies/facets": { industries: [{ value: "IT Services & Consulting", count: 4 }], company_sizes: [], portals: [] },
      "GET /companies": { items: [SIMILAR], total: 1, page: 1, size: 5 },
      "POST /companies": { id: 42, name: "Acme Labs" },
    });
    renderAt(<AddCompanyPage />, { path: "/companies/new", route: "/companies/new" });
    await userEvent.type(screen.getByLabelText("Company name *"), "Acme Labs");
    expect(await screen.findByRole("link", { name: "Acme Corp" })).toHaveAttribute("href", "/companies/3");
    await userEvent.type(screen.getByLabelText("Website"), "https://acmelabs.io");
    await userEvent.type(screen.getByLabelText(/^Careers page \/ job board/), "https://jobs.lever.co/acmelabs");
    await userEvent.selectOptions(screen.getByLabelText("Employees"), "51-200");
    await userEvent.selectOptions(screen.getByLabelText("Office in India"), "true");
    await userEvent.type(screen.getByRole("textbox", { name: "India office cities" }), "Pune{Enter}Bengaluru{Enter}");
    await userEvent.selectOptions(screen.getByLabelText(/^Tier/), "TIER_A");
    await userEvent.click(screen.getByRole("checkbox", { name: /Job search/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add company" }));
    await vi.waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Acme Labs", website: "https://acmelabs.io", careers_url: "https://jobs.lever.co/acmelabs",
      employee_range: "51-200", india_presence: true, india_locations: ["Pune", "Bengaluru"], tier: "TIER_A",
      job_search_enabled: true,
    });
  });

  it("checks the name and URLs before saving", async () => {
    const api = mockApi({ "GET /companies/facets": { industries: [], company_sizes: [], portals: [] } });
    renderAt(<AddCompanyPage />, { path: "/companies/new", route: "/companies/new" });
    await userEvent.type(screen.getByLabelText("LinkedIn page"), "https://www.linkedin.com/in/someone");
    await userEvent.click(screen.getByRole("button", { name: "Add company" }));
    expect(await screen.findByText("Company name is required")).toBeInTheDocument();
    expect(screen.getByText("Use a linkedin.com/company/ page URL")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("the companies list links to the page", async () => {
    mockApi({
      "GET /companies": { items: [], total: 0, page: 1, size: 25 },
      "GET /companies/facets": { industries: [], company_sizes: [], portals: [] },
      "GET /companies/stats": { total: 0, by_verification_status: {} },
      "GET /companies/duplicates": { groups: [] },
    });
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    expect(screen.getByRole("link", { name: "+ Add company" })).toHaveAttribute("href", "/companies/new");
  });

  it("companyBody keeps India 'No' and drops unknowns", () => {
    const base = { name: " X ", legal_name: "", aliases: [], website: "", careers_url: "", linkedin_url: "", extra_links: [],
      industry: "", company_type: "", employee_range: "", headquarters: "", india_presence: "false" as const, india_locations: [],
      tier: "", priority: "", hiring_status: "", job_search_enabled: false, source_url: "", notes: "" };
    expect(companyBody(base)).toEqual({ name: "X", india_presence: false });
  });
});
