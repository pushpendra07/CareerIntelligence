import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "../features/companies/CompaniesPage";
import { CompanyDetailPage } from "../features/companies/CompanyDetailPage";
import { CompanyDuplicatesPage } from "../features/companies/CompanyDuplicatesPage";
import { JobDetailPage } from "../features/jobs/JobDetailPage";
import { rememberJobList } from "../features/jobs/JobNav";
import { Highlighted } from "../features/jobs/JobParts";
import { JobStatusOptions, JobsPage } from "../features/jobs/JobsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

const ROW = { id: 7, title: "Magento Lead", status: "NEW", match_score: 80, score_stale: false, jd_status: "OK", created_at: "2026-10-12T08:00:00Z",
  company: { id: 1, name: "Acme", tier: null }, location: "Remote (India / US / Global Delivery)", work_model: "REMOTE", experience_min: null,
  experience_max: null, salary_min: null, salary_max: null, salary_currency: null, sources: ["LINKEDIN"], posting_date: null,
  source_url: "https://acme.example/jobs/7" };
const ROW2 = { ...ROW, id: 8, title: "PHP Architect" };

const DETAIL = {
  ...ROW, locations: [], employment_type: null, application_deadline: null, seniority: "SENIOR", salary_text: null, source_links: [],
  added_via: ["scanner"], original_jd: "Own our Magento 2 platform and GraphQL APIs. Kubernetes is a plus.", parsed_jd: {}, responsibilities: [],
  qualifications: [], required_skills: ["Magento"], preferred_skills: [], manual_fields: [], notes: null, activity: [], comments: [],
  recruiter: null, recommended_cv: null, career_ops: null, career_ops_evaluation: null, analyzed_at: null, score_version: null,
  match: { score: 80, recommendation: "RECOMMENDED", confidence: "HIGH", strong_matches: [], missing: [], blockers: [], components: [],
    skills: [{ skill: "Magento", importance: "REQUIRED", match: "EXACT_MATCH", via: null },
      { skill: "GraphQL", importance: "PREFERRED", match: "RELATED", via: "REST" },
      { skill: "Kubernetes", importance: "PREFERRED", match: "MISSING", via: null }],
    experience_fit: "GOOD", salary_status: "UNKNOWN", location_fit: "PREFERRED", action: "APPLY" },
};

const listOf = (items: unknown[]) => (url: URL) =>
  url.searchParams.get("size") === "1" ? { items: [], total: 1, page: 1, size: 1 } : { items, total: items.length, page: 1, size: 50 };
const lastList = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => new URL(String(c[0]), "http://x"))
  .filter((u) => u.pathname.endsWith("/jobs") && u.searchParams.get("size") !== "1").at(-1)!;

describe("jobs list", () => {
  it("row actions: Shortlist and Not relevant as buttons; every other step under ⋯", async () => {
    const api = mockApi({ "GET /jobs": listOf([ROW]), "POST /jobs/7/status": { ok: true } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    const shortlist = await screen.findByRole("button", { name: "Shortlist Magento Lead" });
    expect(within(shortlist.parentElement!).getAllByRole("button").map((b) => b.getAttribute("aria-label")))
      .toEqual(["Shortlist Magento Lead", "Not relevant: Magento Lead", "More actions for Magento Lead"]);
    expect(screen.queryByRole("button", { name: "Closed: Magento Lead" })).not.toBeInTheDocument();
    const more = () => userEvent.click(screen.getByRole("button", { name: "More actions for Magento Lead" }));
    await more();
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(
      ["Mark applied", "Mark closed", "Ignore for now", "Duplicate", "Open posting ↗"]);
    expect(within(menu).getByRole("menuitem", { name: "Open posting: Magento Lead" })).toHaveAttribute("href", ROW.source_url);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Applied: Magento Lead" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // a status choice closes the menu
    await more();
    await userEvent.click(screen.getByRole("menuitem", { name: "Closed: Magento Lead" }));
    await userEvent.click(screen.getByRole("button", { name: "Not relevant: Magento Lead" }));
    await userEvent.click(shortlist);
    expect(api.calls.filter((c) => c.path === "/jobs/7/status").map((c) => c.body))
      .toEqual([{ status: "APPLIED" }, { status: "CLOSED" }, { status: "NOT_RELEVANT" }, { status: "SHORTLISTED" }]);
  });

  it("status: the pill, what it means and since when; actions are verbs below it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    mockApi({ "GET /jobs": listOf([{ ...ROW, status: "SHORTLISTED", status_changed_at: "2026-10-19T09:00:00Z" }]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    expect(await screen.findByText(/^apply next ·/)).toHaveAttribute("title", expect.stringContaining("Status set"));
    expect(screen.getByText("3 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply to Magento Lead" })).toHaveTextContent("Apply");
    expect(screen.getByRole("button", { name: "Not relevant: Magento Lead" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Magento Lead" }));
    expect(screen.getByRole("menuitem", { name: "Closed: Magento Lead" })).toHaveTextContent("Mark closed");
    expect(screen.getByRole("menuitem", { name: "Applied: Magento Lead" })).toHaveTextContent("Mark applied");
    vi.useRealTimers();
  });

  it("quick views set several filters; each active filter is a removable chip", async () => {
    const api = mockApi({ "GET /jobs": listOf([ROW]) });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await screen.findByText("Magento Lead");
    await userEvent.click(screen.getByRole("button", { name: "Not applied, 70+" }));
    await vi.waitFor(() => expect(lastList(api.fn).searchParams.get("min_score")).toBe("70"));
    expect(lastList(api.fn).searchParams.get("has_application")).toBe("false");
    const chips = screen.getByLabelText("Active filters");
    expect(chips).toHaveTextContent("Score 70+");
    await userEvent.click(within(chips).getByRole("button", { name: "Remove filter Score 70+" }));
    await vi.waitFor(() => expect(lastList(api.fn).searchParams.get("min_score")).toBeNull());
    expect(lastList(api.fn).searchParams.get("has_application")).toBe("false");
  });

  it("previews a job beside the list when a row is clicked", async () => {
    mockApi({ "GET /jobs": listOf([ROW, ROW2]), "GET /jobs/7": DETAIL, "GET /jobs/8": { ...DETAIL, id: 8, title: "PHP Architect" } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    const cell = (await screen.findAllByText("Remote (India / US / Global Delivery)"))[0];
    await userEvent.click(cell);
    const panel = await screen.findByRole("dialog", { name: "Job preview" });
    expect(await within(panel).findByText("Is this worth applying to?")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open full page →" })).toHaveAttribute("href", "/jobs/7");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(await within(panel).findByRole("heading", { name: /PHP Architect/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Job preview" })).not.toBeInTheDocument();
  });
});

describe("ignore and duplicate", () => {
  it("are in each row's ⋯ menu and always under Most used", async () => {
    const api = mockApi({ "GET /jobs": listOf([ROW]), "POST /jobs/7/status": { ok: true },
      "GET /jobs/status-usage": { APPLIED: 9, NOT_RELEVANT: 5, CLOSED: 3 } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    const more = async () => userEvent.click(await screen.findByRole("button", { name: "More actions for Magento Lead" }));
    await more();
    await userEvent.click(screen.getByRole("menuitem", { name: "Ignore: Magento Lead" }));
    await more();
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate: Magento Lead" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/jobs/7/status").map((c) => c.body))
      .toEqual([{ status: "IGNORED" }, { status: "DUPLICATE" }]));
    renderAt(<select aria-label="Status"><JobStatusOptions /></select>);
    const most = await screen.findByRole("group", { name: "Most used" });
    await waitFor(() => expect(within(most).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Applied", "Not Relevant", "Closed", "Ignored", "Duplicate"]));
  });

  it("are quick buttons on the job page and its preview", async () => {
    const api = mockApi({ "GET /jobs": listOf([ROW]), "GET /jobs/7": DETAIL, "POST /jobs/7/status": { ok: true } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click((await screen.findAllByText("Remote (India / US / Global Delivery)"))[0]);
    const panel = await screen.findByRole("dialog", { name: "Job preview" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/jobs/7/status")?.body).toEqual({ status: "DUPLICATE" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Job preview" })).not.toBeInTheDocument());
  });
});

describe("job preview", () => {
  it("closes after a status change made in it", async () => {
    const api = mockApi({ "GET /jobs": listOf([ROW, ROW2]), "GET /jobs/7": DETAIL, "POST /jobs/7/status": { ok: true } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click((await screen.findAllByText("Remote (India / US / Global Delivery)"))[0]);
    const panel = await screen.findByRole("dialog", { name: "Job preview" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Not relevant" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Job preview" })).not.toBeInTheDocument());
    expect(api.calls.find((c) => c.path === "/jobs/7/status")?.body).toEqual({ status: "NOT_RELEVANT" });
  });

  it("closes on a click outside it; another row switches it to that job", async () => {
    mockApi({ "GET /jobs": listOf([ROW, ROW2]), "GET /jobs/7": DETAIL, "GET /jobs/8": { ...DETAIL, id: 8, title: "PHP Architect" } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    const cells = await screen.findAllByText("Remote (India / US / Global Delivery)");
    await userEvent.click(cells[0]);
    const panel = await screen.findByRole("dialog", { name: "Job preview" });
    await userEvent.click(within(panel).getByText("Is this worth applying to?", {}, )); // inside: stays
    expect(screen.getByRole("dialog", { name: "Job preview" })).toBeInTheDocument();
    await userEvent.click(cells[1]); // another row: shows that job
    expect(await within(screen.getByRole("dialog", { name: "Job preview" })).findByRole("heading", { name: /PHP Architect/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("heading", { name: /jobs$/, level: 1 })); // outside: closes
    expect(screen.queryByRole("dialog", { name: "Job preview" })).not.toBeInTheDocument();
  });

  it("stays open when the change fails, showing why", async () => {
    mockApi({ "GET /jobs": listOf([ROW]), "GET /jobs/7": DETAIL,
      "POST /jobs/7/status": () => { throw Object.assign(new Error("Server error"), { status: 500 }); } });
    renderAt(<JobsPage />, { path: "/jobs", route: "/jobs" });
    await userEvent.click((await screen.findAllByText("Remote (India / US / Global Delivery)"))[0]);
    const panel = await screen.findByRole("dialog", { name: "Job preview" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Not relevant" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("dialog", { name: "Job preview" })).toBeInTheDocument();
  });
});

describe("job page", () => {
  const routes = {
    "GET /jobs/7": DETAIL, "GET /applications": { items: [], total: 0 }, "GET /interviews": { items: [], total: 0 },
    "GET /followups": { items: [], total: 0 }, "GET /jobs": { items: [ROW, { ...ROW2, status: "NOT_RELEVANT" }, { ...ROW, id: 9, title: "Commerce Lead" }], total: 3 },
    "GET /companies/1": { id: 1, name: "Acme", industry: "IT Services", employee_range: "51-200", headquarters: "Pune", tier: null,
      hiring_status: "HIRING", website: "https://acme.example", careers_url: null, linkedin_url: null, aliases: [], attributes: { naukri: { rating: 4.2, reviews: 80 } },
      extra_links: [{ portal: "naukri", url: "https://www.naukri.com/acme-overview-1", source: "naukri", added_at: null }], sources: [] },
  };

  it("moves through the list it came from and jumps to sections", async () => {
    rememberJobList([5, 7, 8]);
    mockApi(routes);
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/7" });
    expect(await screen.findByRole("link", { name: "Previous job" })).toHaveAttribute("href", "/jobs/5");
    expect(screen.getByRole("link", { name: "Next job" })).toHaveAttribute("href", "/jobs/8");
    expect(screen.getByText("2/3")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Description" })).toHaveAttribute("href", "#description");
    expect(document.getElementById("description")).not.toBeNull();
  });

  it("Tailor CV opens the CV tailor on the job page, not in the edit form", async () => {
    mockApi(routes);
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/7" });
    const button = await screen.findByRole("button", { name: "Tailor CV" });
    expect(screen.queryByLabelText(/Your CV/)).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByRole("heading", { name: "Tailor your CV for this job" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Your CV/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit job" }));
    expect(screen.getAllByLabelText(/Your CV/)).toHaveLength(1); // only in the tailor card
    await userEvent.click(screen.getByRole("button", { name: "Close Tailor CV" }));
    expect(screen.queryByLabelText(/Your CV/)).not.toBeInTheDocument();
  });

  it("shows the company with its links and other jobs, and marks skills in the description", async () => {
    mockApi(routes);
    renderAt(<JobDetailPage />, { path: "/jobs/:id", route: "/jobs/7" });
    const card = await screen.findByTestId("company-card");
    expect(await within(card).findByRole("link", { name: "Naukri ↗" })).toHaveAttribute("href", "https://www.naukri.com/acme-overview-1");
    expect(within(card).getByText(/IT Services · 51-200 employees · Pune · ★ 4.2/)).toBeInTheDocument();
    expect(await within(card).findByRole("link", { name: "Commerce Lead" })).toBeInTheDocument();
    expect(within(card).queryByText("PHP Architect")).not.toBeInTheDocument(); // not relevant: left out
    expect(within(card).queryByText("Magento Lead")).not.toBeInTheDocument(); // this job
    expect(screen.getByTitle("You have this skill")).toHaveTextContent("Magento");
    expect(screen.getByTitle("You have a related skill")).toHaveTextContent("GraphQL");
    expect(screen.getByTitle("Not in your profile")).toHaveTextContent("Kubernetes");
  });
});

describe("skill highlighting", () => {
  it("marks whole words only, any case, longer names first", () => {
    const { container } = renderAt(<Highlighted text="Adobe Commerce and commerce; Java vs JavaScript" marks={{ have: ["Adobe Commerce", "JavaScript"], related: [], missing: ["Java"] }} />);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Adobe Commerce", "Java", "JavaScript"]);
  });
});

const CO = { id: 3, name: "Acme", tier: null, verification_status: "RESEARCHED", verification_score: 10, india_presence: null, india_locations: [],
  careers_url: null, ats_provider: null, hiring_status: "HIRING", job_search_enabled: false, company_type: null, industry: "IT Services",
  employee_range: "51-200", rating: 4.3, rating_reviews: 1200, job_count: 0, open_job_count: 0, extra_links: [], created_at: "2026-10-20T12:00:00Z",
  website: null, domain: null, aliases: [] };

describe("companies list", () => {
  it("filters by portal, industry and size; shows rating and size", async () => {
    const api = mockApi({
      "GET /companies": { items: [CO], total: 1, page: 1, size: 25 }, "GET /companies/stats": {},
      "GET /companies/facets": { industries: [{ value: "IT Services", count: 1 }], company_sizes: [{ value: "51-200", count: 1 }], portals: [{ value: "naukri", count: 5 }] },
      "GET /companies/duplicates": { groups: [], total: 4 },
    });
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    expect(await screen.findByTitle("Employee rating on Naukri from 1,200 reviews")).toHaveTextContent("★ 4.3");
    expect(await screen.findByRole("link", { name: "4 possible duplicates" })).toHaveAttribute("href", "/companies/duplicates");
    expect(screen.queryByRole("combobox", { name: "Portal link" })).not.toBeInTheDocument(); // behind Filters
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Portal link" }), await screen.findByRole("option", { name: "On Naukri (5)" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Company size" }), "51-200");
    const url = new URL(String(api.fn.mock.calls.filter((c) => String(c[0]).includes("/companies?")).at(-1)![0]), "http://x");
    expect(url.searchParams.get("portal")).toBe("naukri");
    expect(url.searchParams.get("company_size")).toBe("51-200");
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent("Filters2");
    await userEvent.click(screen.getByRole("button", { name: "Clear 2 filters" }));
  });

  it("hides and shows columns, remembered for next time", async () => {
    mockApi({ "GET /companies": { items: [CO], total: 1, page: 1, size: 25 }, "GET /companies/stats": {} });
    const first = renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    await screen.findByTitle("Employee rating on Naukri from 1,200 reviews");
    const heads = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.replace(/[▲▼↕]/g, "").trim());
    expect(heads()).not.toContain("Size"); // hidden by default
    expect(heads()).toContain("Rating");
    await userEvent.click(screen.getByRole("button", { name: /^Columns/ }));
    const menu = screen.getByRole("group", { name: "Columns shown" });
    await userEvent.click(within(menu).getByRole("checkbox", { name: "Size" }));
    await userEvent.click(within(menu).getByRole("checkbox", { name: "Rating" }));
    expect(heads()).toContain("Size");
    expect(heads()).not.toContain("Rating");
    first.unmount();
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    await screen.findAllByRole("columnheader");
    expect(heads()).toContain("Size");
    expect(heads()).not.toContain("Rating");
    expect(screen.getByRole("columnheader", { name: "Company" })).toHaveClass("sticky");
  });

  it("acts on ticked companies", async () => {
    const api = mockApi({
      "GET /companies": { items: [CO, { ...CO, id: 4, name: "Beta" }], total: 2, page: 1, size: 25 }, "GET /companies/stats": {},
      "POST /companies/bulk": { updated: 2, deleted: 0, skipped: [] },
    });
    renderAt(<CompaniesPage />, { path: "/companies", route: "/companies" });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all companies on this page" }));
    const bar = screen.getByRole("region", { name: "Selected companies" });
    await userEvent.click(within(bar).getByRole("button", { name: "Turn job search on" }));
    expect(api.calls.find((c) => c.path === "/companies/bulk")?.body).toEqual({ company_ids: [3, 4], action: "job_search_on" });
    expect(await screen.findByText("Updated 2 companies.")).toBeInTheDocument();
  });
});

describe("possible duplicates", () => {
  it("merges into the company picked to keep, or marks them different", async () => {
    const group = { reason: "similar name", companies: [{ ...CO, id: 3, name: "Kellton", job_count: 0 }, { ...CO, id: 9, name: "Kellton Tech", job_count: 4 }] };
    const api = mockApi({ "GET /companies/duplicates": { groups: [group], total: 1 }, "POST /companies/9/merge": { id: 9 }, "POST /companies/duplicates/dismiss": null });
    renderAt(<CompanyDuplicatesPage />);
    expect(await screen.findByRole("radio", { name: "Keep Kellton Tech" })).toBeChecked(); // the one with jobs
    await userEvent.click(screen.getByRole("button", { name: "Merge into Kellton Tech" }));
    expect(api.calls.find((c) => c.path === "/companies/9/merge")?.body).toEqual({ merge_id: 3 });
    await userEvent.click(screen.getByRole("button", { name: "Not duplicates" }));
    expect(api.calls.find((c) => c.path === "/companies/duplicates/dismiss")?.body).toEqual({ company_ids: [3, 9] });
  });
});

describe("company page", () => {
  it("shows key facts and links up top, readable research, and where to find more links", async () => {
    mockApi({
      "GET /companies/3": { ...CO, website: "https://acme.example", attributes: { naukri: { rating: 4.3, reviews: 1200, founded: "2010", jobs_page: "https://www.naukri.com/acme-overview-1?tab=jobs", naukri_id: "1" }, scan_excluded: false },
        extra_links: [{ portal: "naukri", url: "https://www.naukri.com/acme-overview-1", source: "naukri", added_at: null }], sources: [], stats: {} },
      "GET /recruiters": { items: [], total: 0 }, "GET /jobs": { items: [], total: 0 }, "GET /preferences": {}, "GET /settings/app": {},
      "GET /scanner/companies/3/board": null,
    });
    renderAt(<CompanyDetailPage />, { path: "/companies/:id", route: "/companies/3" });
    expect(await screen.findByTestId("company-facts")).toHaveTextContent("IT Services · 51-200 employees · founded 2010");
    const links = screen.getByLabelText("Company links");
    expect(within(links).getByRole("link", { name: "Naukri ↗" })).toBeInTheDocument();
    expect(within(links).getByRole("link", { name: "Jobs on Naukri ↗" })).toBeInTheDocument();
    const find = screen.getByLabelText("Find more links");
    expect(within(find).queryByRole("link", { name: "Naukri ↗" })).not.toBeInTheDocument(); // already linked
    expect(within(find).getByRole("link", { name: "Foundit ↗" })).toHaveAttribute("href", expect.stringContaining("site%3Afoundit.in"));
    const research = screen.getByTestId("imported-research");
    expect(research).toHaveTextContent("Naukri ID");
    expect(research).not.toHaveTextContent("scan_excluded");
    expect(screen.getByText(/Verification evidence/).closest("details")).not.toHaveAttribute("open");
  });
});
