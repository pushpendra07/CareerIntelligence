import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginSettings } from "../features/settings/LoginSettings";
import { mockApi, renderAt } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const body = (init?: RequestInit) => JSON.parse(String(init?.body));

describe("Settings → Login", () => {
  it("creates a login when there is none", async () => {
    let enabled = false;
    const api = mockApi({
      "GET /auth/account": () => ({ enabled, username: enabled ? "me" : null, min_password: 8 }),
      "POST /auth/account": () => { enabled = true; return { enabled: true, username: "me" }; },
    });
    renderAt(<LoginSettings />);
    const button = await screen.findByRole("button", { name: "Turn on login" });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "me" } });
    fireEvent.change(screen.getAllByLabelText(/^Password/)[0], { target: { value: "short" } });
    expect(screen.getByText("At least 8 characters", { selector: ".text-rose-600" })).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText(/^Password/)[0], { target: { value: "longenough" } });
    fireEvent.change(screen.getByLabelText(/^Password again/), { target: { value: "longenougX" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Password again/), { target: { value: "longenough" } });
    fireEvent.click(button);
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/auth/account")).toBe(true));
    expect(api.calls.find((c) => c.path === "/auth/account" && c.method === "POST")?.body)
      .toEqual({ username: "me", password: "longenough" });
    expect(await screen.findByText("Username and password")).toBeInTheDocument();
  });

  it("changes the password with the current one, and shows a wrong current password", async () => {
    const api = mockApi({
      "GET /auth/account": { enabled: true, username: "me", min_password: 8 },
      "PUT /auth/account": (_u: URL, init?: RequestInit) => body(init).current_password === "old-password"
        ? { enabled: true, username: "me" }
        : new Response(JSON.stringify({ error: { code: "validation_error", message: "Current password is wrong" } }), { status: 422, headers: { "content-type": "application/json" } }),
    });
    renderAt(<LoginSettings />);
    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "brand-new-pw" } });
    fireEvent.change(screen.getByLabelText(/^New password again/), { target: { value: "brand-new-pw" } });
    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: "nope" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is wrong");
    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: "old-password" } });
    fireEvent.click(save);
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(api.calls.filter((c) => c.method === "PUT")[1].body)
      .toEqual({ current_password: "old-password", new_password: "brand-new-pw" });
  });

  it("logs out other devices after confirming", async () => {
    const api = mockApi({
      "GET /auth/account": { enabled: true, username: "me", min_password: 8 },
      "POST /auth/logout-others": { enabled: true, username: "me" },
    });
    renderAt(<LoginSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Log out other devices" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, log them out" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/auth/logout-others")).toBe(true));
  });
});
