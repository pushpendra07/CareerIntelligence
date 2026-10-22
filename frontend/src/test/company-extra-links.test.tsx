import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "../features/companies/CompaniesPage";
import { ExtraLinks } from "../features/companies/ExtraLinks";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const NAUKRI = { portal: "naukri", url: "https://www.naukri.com/acme-overview-1", source: "naukri", added_at: "2026-10-20T12:30:00Z" };

describe("company extra links", () => {
  it("lists portal links and the date and time a company was added", async () => {
    mockApi({
      "GET /companies": { items: [{ id: 3, name: "Acme", tier: null, verification_status: "DISCOVERED", verification_score: 0,
        india_presence: null, india_locations: [], careers_url: null, ats_provider: null, hiring_status: "HIRING",
        job_search_enabled: false, company_type: null, industry: "IT Services", job_count: 0, open_job_count: 0,
        extra_links: [NAUKRI], created_at: "2026-10-20T12:30:00Z" }], total: 1, page: 1, size: 10 },
      "GET /companies/stats": {},
    });
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    expect(await screen.findByRole("link", { name: "Naukri ↗" })).toHaveAttribute("href", NAUKRI.url);
    expect(screen.getByTitle("Added to this app")).toHaveTextContent("2026");
    expect(screen.getByRole("option", { name: "Recently added" })).toHaveValue("-created_at");
  });

  it("edits the links, one per line", async () => {
    const api = mockApi({ "PATCH /companies/3": { id: 3 } });
    renderAt(<ExtraLinks companyId={3} links={[NAUKRI]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", { name: "Extra links" });
    expect(box).toHaveValue(NAUKRI.url);
    await userEvent.type(box, "\nhttps://www.linkedin.com/company/acme");
    await userEvent.click(screen.getByRole("button", { name: "Save links" }));
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      extra_links: [NAUKRI.url, "https://www.linkedin.com/company/acme"],
    });
  });
});
