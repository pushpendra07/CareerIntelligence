import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToCalendar, CalendarFeed } from "../components/AddToCalendar";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

describe("calendar", () => {
  it("links one event to Google Calendar and as an .ics file", () => {
    renderAt(<AddToCalendar kind="interview" id={12} />);
    expect(screen.getByRole("link", { name: "Google" })).toHaveAttribute("href", "/api/v1/calendar/interview/12/google");
    expect(screen.getByRole("link", { name: "Google" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: ".ics" })).toHaveAttribute("href", "/api/v1/calendar/interview/12.ics");
  });

  it("turns the private feed on, shows the full link, and replaces it after a confirmation", async () => {
    const path = "/api/v1/calendar/feed.ics?token=abc";
    let feed: { enabled: boolean; path: string | null } = { enabled: false, path: null };
    const api = mockApi({
      "GET /calendar/feed": () => feed,
      "POST /calendar/feed": (url: URL) => (feed = { enabled: true, path: url.searchParams.get("new_link") ? `${path}2` : path }),
      "DELETE /calendar/feed": () => (feed = { enabled: false, path: null }),
    });
    renderAt(<CalendarFeed />);
    await userEvent.click(await screen.findByRole("button", { name: "Get my calendar link" }));
    expect(await screen.findByLabelText("Calendar link")).toHaveValue(`${window.location.origin}${path}`);
    expect(screen.getByText(/Apple Calendar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New link or turn off…" }));
    await userEvent.click(screen.getByRole("button", { name: "Make a new link" }));
    await waitFor(() => expect(screen.getByLabelText("Calendar link")).toHaveValue(`${window.location.origin}${path}2`));
    await userEvent.click(screen.getByRole("button", { name: "New link or turn off…" }));
    await userEvent.click(screen.getByRole("button", { name: "Turn the link off" }));
    expect(await screen.findByRole("button", { name: "Get my calendar link" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/calendar/feed", "/calendar/feed"]);
  });
});
