import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../components/AuthGate";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

describe("AuthGate", () => {
  it("shows the app when no password is set", async () => {
    mockApi({ "GET /auth/status": { required: false, authenticated: true } });
    renderAt(<AuthGate><p>The app</p></AuthGate>);
    expect(await screen.findByText("The app")).toBeInTheDocument();
  });

  it("shows the app, and checks only once, when the status check fails", async () => {
    const api = mockApi({}); // every call answers 404
    renderAt(<AuthGate><p>The app</p></AuthGate>);
    expect(await screen.findByText("The app")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(api.calls.filter((c) => c.path === "/auth/status")).toHaveLength(1);
  });

  it("asks for the username and password, shows a wrong one, and lets you in", async () => {
    let loggedIn = false;
    const api = mockApi({
      "GET /auth/status": () => ({ required: true, authenticated: loggedIn }),
      "POST /auth/login": (_u: URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const ok = body.username === "me" && body.password === "pw";
        loggedIn = ok;
        return ok ? { authenticated: true } : new Response(JSON.stringify({ error: { code: "unauthorized", message: "Wrong username or password" } }), { status: 401, headers: { "content-type": "application/json" } });
      },
    });
    renderAt(<AuthGate><p>The app</p></AuthGate>);
    const input = await screen.findByLabelText("Password");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "me" } });
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password");
    fireEvent.change(input, { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("The app")).toBeInTheDocument();
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/auth/login")).toHaveLength(2));
  });
});
