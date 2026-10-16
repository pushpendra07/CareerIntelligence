import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createQueryClient } from "../api/queryClient";
import { GlobalSearch } from "../components/GlobalSearch";
import { mockApi } from "./utils";

afterEach(() => vi.unstubAllGlobals());

const RESULTS = {
  jobs: [{ id: 212, title: "Magento Lead Consultant", subtitle: "Infosys", score: 96 }, { id: 5, title: "Tech Lead - Magento", subtitle: "Ace", score: 94 }],
  companies: [{ id: 128, title: "Magento India", subtitle: "TIER_B" }],
  recruiters: [{ id: 3, title: "Asha Rao", subtitle: "Acme" }],
  skills: [{ id: null, title: "Magento", subtitle: "skill" }],
};

function Where() {
  const l = useLocation();
  return <output aria-label="location">{l.pathname + l.search}</output>;
}

function setup() {
  mockApi({ "GET /search": RESULTS });
  const client = createQueryClient({ queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <GlobalSearch />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole("combobox", { name: "Global search" });
}
const at = () => screen.getByLabelText("location").textContent;

describe("global search", () => {
  it("a slow click still opens the result, then the box clears", async () => {
    const box = setup();
    await userEvent.type(box, "magento");
    const hit = await screen.findByRole("option", { name: /Magento Lead Consultant/ });
    // Pressing a result must not blur the box and close the list before the click lands.
    expect(fireEvent.mouseDown(hit)).toBe(false); // default prevented → focus stays
    await userEvent.click(hit);
    expect(at()).toBe("/jobs/212");
    expect(box).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keyboard: arrows choose, Enter opens; Enter alone shows all matching jobs", async () => {
    const box = setup();
    await userEvent.type(box, "magento");
    await screen.findByRole("option", { name: /Magento Lead Consultant/ });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(at()).toBe("/jobs/5");

    await userEvent.type(box, "magento");
    await screen.findByRole("option", { name: /Magento Lead Consultant/ });
    await userEvent.keyboard("{Enter}");
    expect(at()).toBe("/jobs?q=magento");
  });

  it("every kind of result goes somewhere, and Esc closes", async () => {
    const box = setup();
    await userEvent.type(box, "magento");
    expect(await screen.findByRole("option", { name: /Asha Rao/ })).toHaveAttribute("href", "/recruiters?q=Asha%20Rao");
    const hrefs = screen.getAllByRole("option").map((o) => o.getAttribute("href"));
    expect(hrefs).toContain("/jobs?technology=Magento"); // skill → jobs using it
    expect(hrefs).toContain("/companies/128");
    expect(screen.getByRole("link", { name: /See all jobs matching/ })).toHaveAttribute("href", "/jobs?q=magento");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
