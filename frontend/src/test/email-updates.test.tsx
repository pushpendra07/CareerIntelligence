import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailSettings, EmailUpdatesPage, providerFor, type EmailAccount, type EmailUpdate } from "../features/email/EmailUpdates";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const SETTINGS = { auto_check: true, every_minutes: 30, first_days: 30, notify: true };
const CONNECTED: EmailAccount = {
  connected: true, user: "me@gmail.com", host: "imap.gmail.com", port: 993, folder: "INBOX", is_gmail: true, provider: "gmail",
  settings: SETTINGS, checking: false, pending: 2,
  last_check: { at: "2026-10-22T10:00:00Z", messages: 12, read: 3, found: 2, to_review: 2, more: false, error: null },
};
const OFF: EmailAccount = { ...CONNECTED, connected: false, user: null, host: null, port: null, folder: null, is_gmail: null, provider: null, pending: 0, last_check: null };

const REJECTION: EmailUpdate = {
  id: 1, kind: "REJECTION", state: "PENDING", subject: "Your application", sender_name: "Acme Talent",
  sender_email: "talent@acme.com", received_at: "2026-10-21T04:30:00Z",
  evidence: "Unfortunately, we are moving forward with other candidates.", match_reason: "sent from acme.com",
  company: "Acme", job: { id: 7, title: "Senior PHP Developer", status: "APPLIED", company: "Acme" },
  candidates: [], suggested_status: "REJECTED", applied_status: null,
  open_url: "https://mail.google.com/mail/u/0/#search/rfc822msgid:m1@x",
};
const AMBIGUOUS: EmailUpdate = {
  ...REJECTION, id: 2, kind: "ASSESSMENT", subject: "Umbrella – next steps", company: "Umbrella", job: null,
  evidence: "Please complete the coding challenge.", match_reason: "Umbrella named in the sender or subject",
  suggested_status: "SCREENING", open_url: null,
  candidates: [{ id: 8, title: "PHP Developer", status: "APPLIED", company: "Umbrella" },
    { id: 9, title: "Frontend Engineer", status: "APPLIED", company: "Umbrella" }],
};

describe("Email updates", () => {
  it("shows what each email says and confirms the suggested status", async () => {
    const api = mockApi({
      "GET /email/account": CONNECTED,
      "GET /email/updates": [REJECTION, AMBIGUOUS],
      "POST /email/updates/1/confirm": { ...REJECTION, state: "DONE", applied_status: "REJECTED" },
      "POST /email/updates/2/confirm": { ...AMBIGUOUS, state: "DONE" },
      "POST /email/updates/2/dismiss": { ...AMBIGUOUS, state: "DISMISSED" },
      "POST /email/check": { pending: 2 },
    });
    renderAt(<EmailUpdatesPage />);
    const list = await screen.findByRole("list", { name: "Email updates to review" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Rejection");
    expect(first).toHaveTextContent("“Unfortunately, we are moving forward with other candidates.”");
    expect(within(first).getByRole("link", { name: "Senior PHP Developer" })).toHaveAttribute("href", "/jobs/7");
    expect(within(first).getByRole("link", { name: "Open in Gmail" })).toHaveAttribute("href", REJECTION.open_url);
    expect(within(first).getByLabelText("Set status to")).toHaveValue("REJECTED");
    await userEvent.click(within(first).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/email/updates/1/confirm")?.body)
      .toEqual({ job_id: 7, status: "REJECTED", change_status: true }));

    // No job yet: Confirm waits for the job to be picked.
    const confirm = within(second).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(within(second).getByLabelText("Which job"), "9");
    await userEvent.selectOptions(within(second).getByLabelText("Set status to"), "");
    await userEvent.click(confirm);
    await waitFor(() => expect(api.calls.find((c) => c.path === "/email/updates/2/confirm")?.body)
      .toEqual({ job_id: 9, change_status: false }));

    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/email/check")).toBe(true));
  });

  it("asks to connect the inbox first", async () => {
    mockApi({ "GET /email/account": OFF, "GET /email/updates": [] });
    renderAt(<EmailUpdatesPage />);
    expect(await screen.findByRole("link", { name: "Connect email" })).toHaveAttribute("href", "/settings/email");
    expect(screen.queryByRole("button", { name: "Check now" })).not.toBeInTheDocument();
  });
});

describe("Settings → Email", () => {
  it("connects with an app password, shows a refused login, and saves how often to check", async () => {
    let refuse = true;
    const api = mockApi({
      "GET /email/account": () => (refuse ? OFF : CONNECTED),
      "PUT /email/account": () => refuse
        ? new Response(JSON.stringify({ error: { code: "validation_error", message: "The mail server refused the login." } }),
          { status: 422, headers: { "content-type": "application/json" } })
        : CONNECTED,
      "PATCH /settings/app": {},
    });
    renderAt(<EmailSettings />);
    await userEvent.type(await screen.findByLabelText("Email address"), "me@gmail.com");
    await userEvent.type(screen.getByLabelText("App password"), "abcd efgh ijkl mnop");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("refused the login");
    expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ user: "me@gmail.com", password: "abcd efgh ijkl mnop", host: "imap.gmail.com", port: 993 });

    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("me@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(/12 new messages, 2 job emails found/)).toBeInTheDocument();

    const minutes = screen.getByLabelText("Every (minutes)");
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "15");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ email: { ...SETTINGS, every_minutes: 15 } }));

    // Disconnect asks first (inline, no browser dialog).
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByText(/Forget this account\?/)).toBeInTheDocument();
  });
});

describe("Settings → Email: Yahoo", () => {
  it("picks Yahoo from the address, shows Yahoo's steps and uses Yahoo's server", async () => {
    expect(providerFor("me@yahoo.co.in")).toBe("yahoo");
    expect(providerFor("me@ymail.com")).toBe("yahoo");
    expect(providerFor("me@gmail.com")).toBe("gmail");
    expect(providerFor("me@company.com")).toBeNull();
    const api = mockApi({ "GET /email/account": OFF, "PUT /email/account": { ...CONNECTED, user: "me@yahoo.com", host: "imap.mail.yahoo.com", provider: "yahoo", is_gmail: false } });
    renderAt(<EmailSettings />);
    await userEvent.type(await screen.findByLabelText("Email address"), "me@yahoo.com");
    expect(screen.getByRole("radio", { name: "Yahoo Mail" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("list", { name: "How to connect" })).toHaveTextContent("Generate app password");
    expect(screen.getByRole("link", { name: "Account security" })).toHaveAttribute("href", "https://login.yahoo.com/account/security");
    await userEvent.type(screen.getByLabelText("App password"), "abcdefghijklmnop");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ user: "me@yahoo.com", host: "imap.mail.yahoo.com", port: 993, folder: "INBOX" }));

    // Other: the server fields open, empty.
    await userEvent.click(screen.getByRole("radio", { name: "Other (IMAP)" }));
    expect(screen.getByLabelText("IMAP server")).toHaveValue("");
  });
});
