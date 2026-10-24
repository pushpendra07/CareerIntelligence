import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationDetailsPage } from "../features/profile/ApplicationDetailsPage";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const EMPTY = Object.fromEntries(["first_name", "middle_name", "last_name", "date_of_birth", "email", "phone", "linkedin", "address_line1", "address_line2", "city", "state",
  "postal_code", "country", "current_ctc", "expected_ctc", "salary_negotiable", "notice_period", "relocate", "work_authorization",
  "github", "portfolio", "current_company", "current_title", "recruiter_message"].map((k) => [k, ""]));

describe("application details", () => {
  it("shows what's worked out from the profile and saves your own details for the extension", async () => {
    const api = mockApi({
      "GET /apply/answers": { ...EMPTY, answers: [] },
      "GET /apply/kit": { applicant: { first_name: "Asha", last_name: "Verma", city: "Pune", email: "asha@example.com" } },
      "PUT /apply/answers": (_u: URL, init?: RequestInit) => JSON.parse(String(init?.body)),
    });
    renderAt(<ApplicationDetailsPage />);
    expect(await screen.findByRole("heading", { name: "Application details" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveAttribute("placeholder", "Asha"));
    expect(screen.getByLabelText("City")).toHaveAttribute("placeholder", "Pune");
    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "asha@example.com"); // from the profile
    await userEvent.type(screen.getByLabelText("LinkedIn URL"), "https://www.linkedin.com/in/asha");
    await userEvent.type(screen.getByLabelText("Middle name"), "Rani");
    expect(screen.getByLabelText("Date of birth")).toHaveAttribute("type", "date");
    await userEvent.type(screen.getByLabelText("Date of birth"), "1988-03-07");
    await userEvent.type(screen.getByLabelText("Address"), "12 MG Road");
    await userEvent.type(screen.getByLabelText("PIN / postal code"), "411001");
    await userEvent.type(screen.getByLabelText("Salary negotiable"), "Yes");
    await userEvent.type(screen.getByLabelText("Message to the recruiter"), "Hi, about the role at Acme");
    await userEvent.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({
      middle_name: "Rani", date_of_birth: "1988-03-07", linkedin: "https://www.linkedin.com/in/asha", address_line1: "12 MG Road", postal_code: "411001", salary_negotiable: "Yes",
      recruiter_message: "Hi, about the role at Acme" }));
    expect(screen.getByLabelText("Middle name")).toHaveValue("Rani"); // stays on the page after saving
  });
});
