import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLauncher, ChatPanel } from "../features/chat/Chat";
import { mockApi, renderAt } from "./utils";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("assistant chat", () => {
  it("answers with job cards and runs a proposed change only when confirmed", async () => {
    const api = mockApi({
      "GET /chat/status": { mode: "commands", provider: null },
      "POST /chat": { mode: "commands", reply: "Ready: **Record application: #512 Magento Lead · Acme** — confirm below.",
        cards: [{ type: "jobs", title: "Jobs", total: 3, items: [{ id: 512, title: "Magento Lead", company: "Acme", location: "Pune", score: 84, status: "NEW" }] }],
        actions: [{ id: "a1", kind: "apply", label: "Record application: #512 Magento Lead · Acme", method: "POST", path: "/applications",
          body: { job_id: 512, method: "COMPANY_SITE" }, open_url: "https://jobs.example.com/512" }] },
      "POST /applications": { id: 9 },
    });
    renderAt(<ChatPanel />);
    expect(await screen.findByText(/add an AI key/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message the assistant"), "apply 512{Enter}");
    expect(await screen.findByRole("link", { name: "#512 Magento Lead" })).toHaveAttribute("href", "/jobs/512");
    expect(screen.getByText("Jobs · 1 of 3")).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/chat")?.body).toEqual({ messages: [{ role: "user", content: "apply 512" }] });
    expect(api.calls.some((c) => c.path === "/applications")).toBe(false); // nothing happens before Confirm

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Done/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/applications")?.body).toEqual({ job_id: 512, method: "COMPANY_SITE" });
    expect(screen.getByRole("link", { name: "open the apply page" })).toHaveAttribute("href", "https://jobs.example.com/512");
    expect(JSON.parse(localStorage.getItem("chat.v1") ?? "[]")).toHaveLength(2); // kept across pages
  });

  it("shows the AI provider and sends the conversation", async () => {
    const api = mockApi({
      "GET /chat/status": { mode: "ai", provider: "omniroute", model: "auto" },
      "POST /chat": { mode: "ai", reply: "You have **2** interviews.", cards: [], actions: [] },
    });
    renderAt(<ChatPanel />);
    expect(await screen.findByText("AI · OmniRoute (auto)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upcoming interviews" }));
    expect(await screen.findByText("2")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message the assistant"), "which ones are tomorrow?{Enter}");
    await screen.findAllByText(/interviews\./);
    const last = api.calls.filter((c) => c.path === "/chat").at(-1)?.body as { messages: unknown[] };
    expect(last.messages).toHaveLength(3); // question, answer, follow-up
  });

  it("opens from the corner button and with ⌘J", async () => {
    mockApi({ "GET /chat/status": { mode: "commands", provider: null } });
    renderAt(<ChatLauncher />);
    await userEvent.click(screen.getByRole("button", { name: /Open assistant/ }));
    const dialog = screen.getByRole("dialog", { name: "Assistant" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}j{/Meta}");
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeInTheDocument();
  });

  it("is hidden when turned off in Settings", async () => {
    mockApi({ "GET /chat/status": { enabled: false, mode: "commands", provider: null } });
    renderAt(<ChatLauncher />);
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Open assistant/ })).not.toBeInTheDocument());
    await userEvent.keyboard("{Meta>}j{/Meta}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
