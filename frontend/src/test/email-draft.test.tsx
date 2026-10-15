import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDraft } from "../features/jobs/EmailDraft";
import type { JobDetail } from "../types/api";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 7, title: "Magento Lead", location: "Pune, India", company: { id: 1, name: "Acme" } } as unknown as JobDetail;
const DRAFT = {
  to: "asha@acme.example", to_options: [{ name: "Asha", email: "asha@acme.example", job_title: null }],
  subjects: ["Application for Magento Lead", "Magento Lead at Acme – 12+ yrs"],
  body: "Hello Hiring Team,\n\nI'm writing about the Magento Lead role at Acme.", company: "Acme", company_domain: "acme.example",
};

describe("email draft", () => {
  it("drafts, lets the subject be picked and copied, and searches for HR emails", async () => {
    const api = mockApi({ "GET /jobs/7/email-draft": DRAFT });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt(<EmailDraft job={JOB} />);

    // Before drafting: HR search by company name.
    const google = () => new URL(screen.getByRole("link", { name: "Google" }).getAttribute("href")!).searchParams.get("q");
    expect(google()).toContain('"Acme"');

    await userEvent.click(screen.getByRole("button", { name: "Draft email" }));
    expect(await screen.findByLabelText("Subject")).toHaveValue("Application for Magento Lead");
    expect(screen.getByLabelText("Message")).toHaveValue(DRAFT.body);
    expect(screen.getByLabelText("To")).toHaveValue("asha@acme.example");
    expect(api.calls.filter((c) => c.path === "/jobs/7/email-draft")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Magento Lead at Acme – 12+ yrs" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Magento Lead at Acme – 12+ yrs");
    await userEvent.click(screen.getByRole("button", { name: "Copy subject" }));
    expect(writeText).toHaveBeenCalledWith("Magento Lead at Acme – 12+ yrs");
    expect(await screen.findByRole("button", { name: "Copied ✓" })).toBeInTheDocument();

    // After drafting: HR search uses the company's email domain; AI is told not to guess.
    const [hrGoogle] = screen.getAllByRole("link", { name: "Google" });
    expect(new URL(hrGoogle.getAttribute("href")!).searchParams.get("q")).toContain('"@acme.example"');
    const claude = screen.getAllByRole("link", { name: "Claude" }).map((a) => new URL(a.getAttribute("href")!).searchParams.get("q")!);
    expect(claude[0]).toContain("Do not guess");
    expect(claude[1]).toContain("Subject: Magento Lead at Acme – 12+ yrs"); // polish the edited draft
    const mail = screen.getByRole("link", { name: "Open in email app" }).getAttribute("href")!;
    expect(mail.startsWith("mailto:asha%40acme.example?subject=Magento%20Lead")).toBe(true);
  });
});
