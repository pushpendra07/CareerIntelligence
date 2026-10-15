import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pagination, pageRange } from "../components/ui";
import { JobsPage } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("pagination", () => {
  it("shows the pages around the current one", () => {
    expect(pageRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageRange(6, 45)).toEqual([1, "…", 4, 5, 6, 7, 8, "…", 45]);
    expect(pageRange(45, 45)).toEqual([1, "…", 43, 44, 45]);
  });

  it("numbers, first/last, go-to-page and rows per page", async () => {
    const onPage = vi.fn();
    const onSize = vi.fn();
    render(<Pagination page={6} size={10} total={447} onPage={onPage} onSize={onSize} noun="jobs" />);
    expect(screen.getByText("51–60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 6" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Page 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Last page" }));
    await userEvent.click(screen.getByRole("button", { name: "First page" }));
    await userEvent.type(screen.getByLabelText("Go to page"), "99");
    await userEvent.click(screen.getByRole("button", { name: "Go" })); // past the end → last page
    expect(onPage.mock.calls.map((c) => c[0])).toEqual([7, 45, 1, 45]);
    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "50");
    expect(onSize).toHaveBeenCalledWith(50);
  });

  it("one page: just the count", () => {
    render(<Pagination page={1} size={25} total={3} onPage={() => {}} noun="companies" />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("1–3")).toBeInTheDocument();
  });

  it("jobs list: rows per page is remembered and goes back to page 1", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Job ${i + 1}`, status: "NEW", match_score: 80, score_stale: false,
      jd_status: "OK", created_at: "2026-10-12T08:00:00Z", company: { id: 1, name: "Acme", tier: null }, location: null, work_model: "UNKNOWN",
      experience_min: null, experience_max: null, salary_min: null, salary_max: null, salary_currency: null, sources: [], posting_date: null }));
    const api = mockApi({ "GET /jobs": (url: URL) => ({ items, total: 447, page: Number(url.searchParams.get("page") ?? 1), size: 25 }),
      "GET /jobs/status-counts": {} });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs?page=3" });
    expect(await screen.findByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText("51–75")).toHaveLength(2); // top and bottom
    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "100");
    const last = api.calls.filter((c) => c.path === "/jobs").at(-1);
    expect(last).toBeTruthy();
    const urls = api.fn.mock.calls.map((c) => new URL(String(c[0]), "http://x")).filter((u) => u.pathname.endsWith("/jobs"));
    expect(urls.at(-1)!.searchParams.get("size")).toBe("100");
    expect(urls.at(-1)!.searchParams.get("page")).toBe("1");
    expect(window.localStorage.getItem("jobs.pageSize.v1")).toBe("100");
  });
});
