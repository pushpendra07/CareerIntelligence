import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSearchPage, buildPrompt } from "../features/jobs/AiSearchPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const PREFS = { effective_titles: ["Senior PHP Developer", "Technical Lead"], preferred_skills: ["PHP", "Magento 2"], preferred_locations: ["Pune", "Remote India"],
  remote_ok: true, hybrid_ok: true, onsite_ok: false, min_salary: "1800000.00", target_salary: "2500000.00", salary_currency: "INR" };

describe("AI job search", () => {
  it("builds the prompt from the target profile and chosen portals", () => {
    const p = buildPrompt(PREFS, ["LinkedIn", "Naukri"], 15, 7, "http://app/jobs/ai-search", "http://api/agent-import");
    expect(p).toContain("Job titles: Senior PHP Developer, Technical Lead");
    expect(p).toContain("Salary: at least 18 LPA, target 25 LPA");
    expect(p).toContain("Work type: remote (from India), hybrid");
    expect(p).toContain("LinkedIn, Naukri.");
    expect(p).toContain("Stop after 15 good jobs");
    expect(p).toContain("Open http://app/jobs/ai-search");
    expect(p).toContain("never enter passwords");
  });

  it("checks pasted jobs for duplicates, then adds only the new ones", async () => {
    const results = [
      { index: 0, result: "new", title: "Senior PHP Developer", company: "Beta", has_description: true, job_id: null },
      { index: 1, result: "duplicate", title: "Magento Lead", company: "Acme", job_id: 512, existing_title: "Magento Lead" },
    ];
    const api = mockApi({
      "GET /preferences": PREFS,
      "POST /jobs/agent-import": (_u: URL, init?: RequestInit) => {
        const dry = JSON.parse(String(init?.body)).dry_run;
        return { dry_run: dry, counts: { new: 1, duplicate: 1, repeat: 0, deleted: 0, invalid: 0 },
          results: dry ? results : [{ ...results[0], job_id: 900 }, results[1]] };
      },
    });
    renderAt(<AiSearchPage />);
    expect(await screen.findByDisplayValue(/Senior PHP Developer, Technical Lead/)).toBeInTheDocument();
    const box = screen.getByLabelText("Jobs from the assistant");
    fireEvent.change(box, { target: { value: "not json" } });
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText(/isn't valid JSON/)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '```json\n[{"title": "Senior PHP Developer", "company": "Beta"}, {"title": "Magento Lead", "company": "Acme"}]\n```' } });
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Already in the app")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#512" })).toHaveAttribute("href", "/jobs/512");
    const posts = () => api.calls.filter((c) => c.method === "POST");
    expect(posts().at(-1)?.body).toMatchObject({ dry_run: true, jobs: [{ title: "Senior PHP Developer" }, { title: "Magento Lead" }] });

    await userEvent.click(screen.getByRole("button", { name: "Add 1 new job" }));
    expect(await screen.findByText(/Added 1 new job/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#900" })).toHaveAttribute("href", "/jobs/900");
    expect(posts().at(-1)?.body).toMatchObject({ dry_run: false });
  });
});

describe("portal search", () => {
  it("fills each portal's search with the title, place and age", async () => {
    const { PORTALS } = await import("../features/jobs/portals");
    const url = (name: string, location = "Pune") => PORTALS.find((p) => p.name === name)!.search({ title: "Senior PHP Developer", location, days: 14 });
    expect(url("LinkedIn")).toBe("https://www.linkedin.com/jobs/search/?keywords=Senior%20PHP%20Developer&location=Pune&f_TPR=r1209600");
    expect(url("LinkedIn", "Remote India")).toContain("location=India&f_TPR=r1209600&f_WT=2");
    expect(url("Naukri")).toBe("https://www.naukri.com/senior-php-developer-jobs-in-pune?k=Senior%20PHP%20Developer&l=Pune&jobAge=14");
    const pick = (name: string, work: ("Remote" | "Hybrid" | "Onsite")[]) =>
      PORTALS.find((p) => p.name === name)!.search({ title: "PHP Lead", location: "Pune", days: 7, work });
    expect(pick("LinkedIn", ["Remote", "Hybrid"])).toContain("&f_WT=2%2C3");
    expect(pick("LinkedIn", ["Remote", "Hybrid", "Onsite"])).not.toContain("f_WT"); // all three = no filter
    expect(pick("Naukri", ["Hybrid", "Onsite"])).toContain("&wfhType=3&wfhType=0&jobAge=7");
    expect(url("Indeed India")).toBe("https://in.indeed.com/jobs?q=Senior%20PHP%20Developer&l=Pune&fromage=14");
  });

  it("portal button → choose Claude → opens the portal and copies its prompt", async () => {
    mockApi({ "GET /preferences": PREFS });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt(<AiSearchPage />);
    await screen.findByDisplayValue(/Senior PHP Developer, Technical Lead/);
    await userEvent.click(screen.getByRole("button", { name: "Naukri" }));
    const dialog = screen.getByRole("dialog", { name: "Search Naukri" });
    // Location: work types (from the target profile: remote + hybrid ok) and cities, multi-select.
    const location = within(dialog).getByRole("button", { name: /Location/ });
    expect(location).toHaveTextContent("Remote, Hybrid · Pune");
    expect(within(dialog).getByText(/2 searches: remote, anywhere in India · hybrid in Pune/)).toBeInTheDocument();
    await userEvent.click(location);
    expect(within(dialog).getByRole("checkbox", { name: /^Remote/ })).toBeChecked();
    expect(within(dialog).getByLabelText("Onsite")).not.toBeChecked();
    expect(within(dialog).queryByLabelText("Remote India")).not.toBeInTheDocument(); // Remote covers it
    await userEvent.click(within(dialog).getByLabelText("Hybrid"));
    expect(within(dialog).getByText(/1 search: remote, anywhere in India/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByText("Claude"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Open Naukri and copy the prompt" }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("https://www.naukri.com/senior-php-developer-jobs?"), "_blank", "noopener");
    expect(writeText.mock.calls[0][0]).toContain('I have opened the Naukri search results for "Senior PHP Developer" — remote, anywhere in India');
    expect(open.mock.calls[0][0]).toBe("https://www.naukri.com/senior-php-developer-jobs?k=Senior%20PHP%20Developer&wfhType=2&jobAge=14");
    expect(within(dialog).getByText(/Claude/, { selector: "b" })).toBeInTheDocument();
    // The collector needs the extension; without it the popup says how to install it.
    await userEvent.click(within(dialog).getByText("Job collector"));
    expect(within(dialog).getByText(/Load unpacked/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Download it" })).toHaveAttribute("href", `/api/v1/extension.zip?app=${encodeURIComponent(window.location.origin)}`);
    expect(within(dialog).getByRole("button", { name: /Collect up to 20 jobs/ })).toBeDisabled();
  });

  it("jobs from the Job collector extension are checked right away", async () => {
    document.documentElement.dataset.ciCollector = "1.0.0";
    const api = mockApi({
      "GET /preferences": PREFS,
      "POST /jobs/agent-import": { dry_run: true, counts: { new: 1, duplicate: 0, repeat: 0, deleted: 0, invalid: 0 },
        results: [{ index: 0, result: "new", title: "Magento Lead", company: "Acme", has_description: true, job_id: null }] },
    });
    const posted = vi.spyOn(window, "postMessage");
    renderAt(<AiSearchPage />);
    await userEvent.click(await screen.findByRole("button", { name: "LinkedIn" }));
    await userEvent.click(screen.getByText("Job collector"));
    await userEvent.click(screen.getByRole("button", { name: "Collect up to 20 jobs" }));
    const msg = posted.mock.calls.find(([m]) => (m as { type?: string }).type === "collect")?.[0] as { urls: string[] };
    expect(msg).toMatchObject({ source: "ci-app", portal: "LinkedIn", max: 20 });
    expect(msg.urls).toHaveLength(2); // remote anywhere in India + hybrid in Pune
    expect(msg.urls[0]).toContain("location=India&f_TPR=r1209600&f_WT=2");
    expect(msg.urls[1]).toContain("location=Pune&f_TPR=r1209600&f_WT=3");
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin,
      data: { source: "ci-collector", type: "done", portal: "LinkedIn", message: "1 job read from LinkedIn.", jobs: [{ title: "Magento Lead", company: "Acme" }] } }));
    expect(await screen.findByText("Add 1 new job")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ dry_run: true, jobs: [{ title: "Magento Lead" }] });
    delete document.documentElement.dataset.ciCollector;
  });
});

describe("Job collector version", () => {
  it("knows when the installed extension needs a reload", async () => {
    const { collectorOutdated, COLLECTOR_VERSION } = await import("../features/jobs/collector");
    expect(collectorOutdated("1.0.0")).toBe(true);
    expect(collectorOutdated(COLLECTOR_VERSION)).toBe(false);
    expect(collectorOutdated(null)).toBe(false);
  });
});
