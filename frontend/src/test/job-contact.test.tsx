import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobContact, contactProblems } from "../features/jobs/JobContact";
import type { JobDetail } from "../types/api";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const JOB = { id: 7, title: "Magento Lead", recruiter: null } as unknown as JobDetail;
const PRIYA = { id: 3, name: "Priya Sharma", job_title: "HR Manager", email: "priya@acme.example", phone: "+91 98765 43210",
  linkedin_url: "https://www.linkedin.com/in/priya", status: "NEW" };

describe("job contact person", () => {
  it("adds a contact: every field optional, at least one needed, values checked", async () => {
    const api = mockApi({ "PUT /jobs/7/contact": { ...JOB, recruiter: PRIYA } });
    const user = userEvent.setup();
    renderAt(<JobContact job={JOB} />);
    expect(screen.getByText(/No contact yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Add contact person" }));
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    expect(screen.getByText("Add at least a name, email, phone or LinkedIn")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Email/), "priya@");
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    expect(screen.getByText("Enter a valid email")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    await user.type(screen.getByLabelText(/^Email/), "acme.example");
    await user.type(screen.getByLabelText("Name"), "Priya Sharma");
    await user.type(screen.getByLabelText("Phone / WhatsApp"), "+91 98765 43210");
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      name: "Priya Sharma", job_title: "", email: "priya@acme.example", phone: "+91 98765 43210", linkedin_url: "" });
  });

  it("shows the contact with ways to reach them; edit and remove", async () => {
    const api = mockApi({ "PUT /jobs/7/contact": { ...JOB, recruiter: PRIYA }, "DELETE /jobs/7/contact": JOB });
    const user = userEvent.setup();
    renderAt(<JobContact job={{ ...JOB, recruiter: PRIYA } as JobDetail} />);
    const card = screen.getByTestId("job-contact");
    expect(card).toHaveTextContent("Priya Sharma");
    expect(card).toHaveTextContent("HR Manager");
    expect(within(card).getByRole("link", { name: "priya@acme.example" })).toHaveAttribute("href", "mailto:priya@acme.example");
    expect(within(card).getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/919876543210");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Priya Sharma");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Remove from this job?")).toBeInTheDocument(); // inline confirm, no browser dialog
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/jobs/7/contact")).toBe(true));
  });

  it("checks phone and LinkedIn", () => {
    const f = { name: "", job_title: "", email: "", phone: "123", linkedin_url: "linkedin.com/company/x" };
    expect(contactProblems(f)).toMatchObject({ phone: "Enter a phone number", linkedin_url: "Use a linkedin.com/in/ profile URL" });
  });
});
