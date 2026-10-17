import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, filterCommands, type Command } from "../components/CommandPalette";
import { Toaster, toast } from "../components/Toaster";
import { mockApi, renderAt } from "./utils";

const PAGES = [{ to: "/followups", label: "Follow-ups", group: "Follow-ups" }, { to: "/reports", label: "Reports", group: "Reports" }];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function app() {
  return renderAt(
    <><CommandPalette pages={PAGES} /><Routes><Route path="*" element={<Where />} /></Routes></>,
    { path: "*", route: "/" },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("command palette", () => {
  it("filters by every typed word, in any order", () => {
    const c = (label: string, group = "Go to"): Command => ({ id: label, label, group, run: () => {} });
    const all = [c("Add a job", "Actions"), c("All jobs"), c("Reports")];
    expect(filterCommands(all, "").length).toBe(3);
    expect(filterCommands(all, "job ADD").map((x) => x.label)).toEqual(["Add a job"]);
    expect(filterCommands(all, "go rep").map((x) => x.label)).toEqual(["Reports"]);
  });

  it("opens with Ctrl+K, finds a page and goes there with Enter", async () => {
    mockApi({ "GET /search": { jobs: [], companies: [] } });
    app();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Command" });
    await userEvent.type(box, "follow");
    expect(screen.getByRole("option", { name: /See follow-ups due/ })).toBeInTheDocument();
    await userEvent.type(box, "{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/followups");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows jobs from search and supports g-shortcuts and ? help", async () => {
    mockApi({ "GET /search": { jobs: [{ id: 7, title: "Platform Lead", subtitle: "Acme" }], companies: [] } });
    app();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await userEvent.type(await screen.findByRole("combobox", { name: "Command" }), "platform");
    await userEvent.click(await screen.findByRole("option", { name: /Platform Lead/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/jobs/7");

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "i" });
    expect(screen.getByTestId("where")).toHaveTextContent("/reports");
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveTextContent("Go to Follow-ups");
  });

  it("ignores shortcuts while typing in a field", () => {
    mockApi({});
    renderAt(<><input aria-label="note" /><CommandPalette pages={PAGES} /><Routes><Route path="*" element={<Where />} /></Routes></>, { path: "*", route: "/" });
    const note = screen.getByLabelText("note");
    fireEvent.keyDown(note, { key: "c" });
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });
});

describe("toasts", () => {
  it("shows a message and lets you dismiss it", async () => {
    renderAt(<Toaster />);
    act(() => toast("Job saved"));
    expect(await screen.findByRole("status")).toHaveTextContent("Job saved");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Job saved")).not.toBeInTheDocument();
  });
});
