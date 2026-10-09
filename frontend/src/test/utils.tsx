import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

/** Render a page inside the providers it needs, at a given route. */
export function renderAt(ui: ReactElement, { path = "/", route = "/" }: { path?: string; route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes><Route path={path} element={ui} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (url: URL, init?: RequestInit) => unknown;

/** Mock fetch with a map of "METHOD /path" -> response body (or a function). */
export function mockApi(routes: Record<string, unknown | Handler>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (!(key in routes)) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: `no mock for ${key}` } }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const value = routes[key];
    const data = typeof value === "function" ? (value as Handler)(url, init) : value;
    if (data instanceof Response) return data;
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}
