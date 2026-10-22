import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplyAssistant, type ApplyKit } from "../features/jobs/ApplyAssistant";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const KIT: ApplyKit = {
  job: { id: 7, title: "Magento Lead", company: "Acme", status: "SHORTLISTED", url: "https://job-boards.greenhouse.io/acme/jobs/1" },
  applicant: { full_name: "Asha Verma", email: "asha@example.com", phone: "+91 90000 00000", current_ctc: "28 LPA", linkedin: "" },
  labels: { full_name: "Full name", email: "Email", phone: "Phone", current_ctc: "Current CTC", linkedin: "LinkedIn" },
  answers: [{ question: "Why Acme?", answer: "Commerce at scale." }],
  cv: { id: 1, name: "Tech Lead – Magento", version_id: 3, filename: "cv.pdf", download: "/api/v1/cvs/1/versions/3/file" },
  cover_note: "Hello, I lead Magento teams.",
  email: { to: "hr@acme.example", subject: "Application: Magento Lead", body: "Dear Priya", name: "Priya" },
  missing: ["LinkedIn"],
};

describe("Apply assistant", () => {
  it("lays out the CV, cover note, details and answers, the ways to apply, and records it", async () => {
    const api = mockApi({ "GET /jobs/7/apply-kit": KIT, "POST /jobs/7/applied": { created: true, follow_up_date: "2026-10-29" } });
    renderAt(<ApplyAssistant jobId={7} />);
    expect(await screen.findByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/v1/cvs/1/versions/3/file");
    expect(screen.getByLabelText("Cover note")).toHaveValue("Hello, I lead Magento teams.");
    const details = screen.getByLabelText("Your details");
    expect(details).toHaveTextContent("Asha Verma");
    expect(within(details).getByRole("button", { name: "Copy Current CTC" })).toBeInTheDocument();
    expect(details).not.toHaveTextContent("LinkedIn"); // empty values aren't listed…
    expect(screen.getByText(/Missing: LinkedIn/)).toBeInTheDocument(); // …they're named as missing
    expect(screen.getByRole("list", { name: "Saved answers" })).toHaveTextContent("Commerce at scale.");
    expect(screen.getByRole("link", { name: "Open application page ↗" })).toHaveAttribute("href", KIT.job!.url);
    expect(screen.getByRole("link", { name: "Email Priya" }).getAttribute("href")).toMatch(/^mailto:hr%40acme\.example\?subject=Application%3A%20Magento%20Lead/);
    await userEvent.click(screen.getByRole("button", { name: "✓ I applied on the site" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/jobs/7/applied")?.body).toEqual({ method: "COMPANY_SITE", cv_version_id: 3 }));
    expect(await screen.findByText(/Recorded — marked Applied, follow up on 2026-10-29/)).toBeInTheDocument();
  });

  it("saves the answers used on every form", async () => {
    const saved = { current_ctc: "", expected_ctc: "", notice_period: "", relocate: "", work_authorization: "", github: "", portfolio: "",
      current_company: "", current_title: "", answers: [] };
    const api = mockApi({ "GET /jobs/7/apply-kit": { ...KIT, email: null }, "GET /apply/answers": saved, "PUT /apply/answers": saved });
    renderAt(<ApplyAssistant jobId={7} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit saved answers" }));
    await userEvent.type(await screen.findByLabelText("Current CTC"), "28 LPA");
    await userEvent.click(screen.getByRole("button", { name: "+ Add a question" }));
    await userEvent.type(screen.getByLabelText("Question 1"), "Years with Magento 2?");
    await userEvent.type(screen.getByLabelText("Answer 1"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({
      current_ctc: "28 LPA", answers: [{ question: "Years with Magento 2?", answer: "9" }] }));
    expect(screen.queryByRole("link", { name: /^Email/ })).not.toBeInTheDocument(); // no HR email: no email option
  });
});
