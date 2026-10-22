import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationsPage } from "../features/applications/ApplicationsPage";
import { OffersPage } from "../features/offers/OffersPage";
import { RecruitersPage } from "../features/recruiters/RecruitersPage";
import { inDays } from "../features/followups/FollowUpParts";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const app = (id: number, title: string, extra: Record<string, unknown>) => ({
  id, job_id: id, job_title: title, company_name: "Acme", applied_on: inDays(-10), method: "OTHER", cv_name: null,
  match_score: 80, status: "APPLIED", follow_up_date: null, next_follow_up: null, events: [], ...extra,
});

describe("applications list", () => {
  it("shows the next follow-up from the Follow-ups list, red when due", async () => {
    mockApi({ "GET /applications": { items: [
      app(1, "Magento Lead", { next_follow_up: inDays(-3) }),
      app(2, "PHP Architect", { next_follow_up: inDays(4) }),
      app(3, "Tech Lead", { follow_up_date: inDays(6) }),
      app(4, "Rejected one", { status: "REJECTED", next_follow_up: inDays(-1) }),
    ], total: 4, page: 1, size: 25 } });
    renderAt(<ApplicationsPage />, { path: "/applications", route: "/applications" });
    const row = async (t: string) => (await screen.findByRole("link", { name: t })).closest("tr")!;
    const late = within(await row("Magento Lead")).getByTitle("Due — open Follow-ups");
    expect(late).toHaveTextContent("· due");
    expect(late).toHaveAttribute("href", "/followups");
    expect(within(await row("PHP Architect")).getByTitle("Open Follow-ups")).not.toHaveTextContent("due");
    expect(within(await row("Tech Lead")).getByTitle("Open Follow-ups")).toBeInTheDocument(); // old field still shown
    expect(within(await row("Rejected one")).queryByTitle("Due — open Follow-ups")).not.toBeInTheDocument();
  });
});

describe("forms open on request", () => {
  it("offers: the form opens from a job page with that job picked", async () => {
    mockApi({ "GET /offers": { items: [], total: 0, page: 1, size: 25 }, "GET /offers/compare": { offers: [] },
      "GET /jobs": { items: [{ id: 7, title: "Magento Lead", company: { id: 1, name: "Acme" } }], total: 1, page: 1, size: 100 } });
    const { unmount } = renderAt(<OffersPage />, { path: "/offers", route: "/offers" });
    expect(await screen.findByRole("button", { name: "+ Record an offer" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Save offer" })).not.toBeInTheDocument();
    unmount();
    renderAt(<OffersPage />, { path: "/offers", route: "/offers?job_id=7" });
    expect(await screen.findByRole("option", { name: "Magento Lead — Acme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save offer" })).toBeEnabled();
  });

  it("recruiters: Add contact opens the form", async () => {
    mockApi({ "GET /recruiters": { items: [], total: 0, page: 1, size: 25 } });
    renderAt(<RecruitersPage />, { path: "/recruiters", route: "/recruiters" });
    expect(screen.queryByRole("button", { name: "Save contact" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Add contact" }));
    expect(screen.getByRole("button", { name: "Save contact" })).toBeDisabled(); // name needed
  });
});
