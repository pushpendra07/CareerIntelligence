import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddJobPage } from "../features/jobs/AddJobPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const ACME = { id: 7, name: "Acme Commerce", tier: "TIER_A", website: "https://www.acme.example/", jobs: 12, aliases: [], match: false };
const LABS = { id: 8, name: "Acme Labs", tier: null, website: null, jobs: 1, aliases: [], match: false };

function suggest(u: URL) {
  const q = (u.searchParams.get("q") ?? "").toLowerCase();
  if (q.startsWith("acme commerce")) return { match: { ...ACME, match: true }, items: [{ ...ACME, match: true }] };
  if (q.startsWith("acme")) return { match: null, items: [ACME, LABS] };
  return { match: null, items: [] };
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Job Title *"), "Tech Lead");
  await user.type(screen.getByLabelText("Job Description *"), "PHP");
}

describe("Add Job: company", () => {
  it("suggests companies while typing; picking one links the job to it", async () => {
    const api = mockApi({ "GET /companies/suggest": suggest, "POST /jobs/preview": { parsed: null }, "POST /jobs": { job: { id: 42 }, created: true } });
    const user = userEvent.setup();
    renderAt(<AddJobPage />, { path: "/jobs/new", route: "/jobs/new" });
    await fill(user);
    await user.type(screen.getByRole("combobox", { name: "Company *" }), "acme");
    expect(await screen.findByRole("option", { name: /Acme Commerce\s*Tier A · 12 jobs · acme\.example/ })).toBeInTheDocument();
    const list = screen.getByRole("listbox", { name: "Companies" });
    expect(within(list).getByRole("option", { name: /^\+ Add “acme” as a new company/ })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}"); // keyboard picks the first one
    expect(screen.getByRole("combobox", { name: "Company *" })).toHaveValue("Acme Commerce");
    expect(screen.getByRole("combobox", { name: "Company *" })).toHaveAccessibleDescription("✓ Linked to Acme Commerce");
    expect(screen.getByRole("link", { name: "Acme Commerce" })).toHaveAttribute("href", "/companies/7");
    await user.click(screen.getByRole("button", { name: /save & analyze/i }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/jobs")).toBe(true));
    expect(api.calls.find((c) => c.path === "/jobs")!.body).toMatchObject({ company: "Acme Commerce", company_id: 7 });
  });

  it("says when a typed name matches a company, and when a new one will be added", async () => {
    const api = mockApi({ "GET /companies/suggest": suggest, "POST /jobs/preview": { parsed: null }, "POST /jobs": { job: { id: 43 }, created: true } });
    const user = userEvent.setup();
    renderAt(<AddJobPage />, { path: "/jobs/new", route: "/jobs/new" });
    const box = screen.getByRole("combobox", { name: "Company *" });
    await user.type(box, "Acme Commerce Pvt Ltd");
    expect(await screen.findByText(/Will be linked to your company/)).toBeInTheDocument();
    expect(await screen.findByText("Same company")).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "Zeta Systems");
    expect(await screen.findByText("New company: it will be added when you save.")).toBeInTheDocument();
    expect(screen.getByText("No saved company matches “Zeta Systems”.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Add “Zeta Systems” as a new company/ })).toHaveTextContent("added and linked to this job when you save");
    await fill(user);
    await user.click(screen.getByRole("button", { name: /save & analyze/i }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/jobs")).toBe(true));
    const sent = api.calls.find((c) => c.path === "/jobs")!.body as Record<string, unknown>;
    expect(sent.company).toBe("Zeta Systems");
    expect(sent).not.toHaveProperty("company_id");
  });
});
