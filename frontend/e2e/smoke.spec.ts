import { expect, test, type Page } from "@playwright/test";

/** Every page a user can reach from the menu. */
const PAGES = [
  "/", "/analytics", "/jobs", "/jobs/review", "/jobs/closed", "/jobs/new", "/companies",
  "/applications/board", "/applications", "/interviews", "/offers", "/recruiters", "/followups",
  "/reports", "/reports/jobs", "/reports/applications", "/profile", "/preferences", "/cvs",
  "/questions", "/settings", "/settings/scoring", "/settings/data", "/settings/about",
];

/** Fails the test on uncaught errors and console errors (ignoring the browser's own noise). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Download the React DevTools/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 15_000 });
}

test("the API is up", async ({ request }) => {
  const health = await request.get("/api/v1/health");
  expect(health.ok()).toBeTruthy();
});

for (const path of PAGES) {
  test(`page ${path} loads without errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await settle(page);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("alert"), "an error box is shown").toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("open a job from the list, and its edit panel", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/jobs");
  await settle(page);
  const hrefs = await page.locator('a[href^="/jobs/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const href = hrefs.find((h) => h && /^\/jobs\/\d+$/.test(h));
  test.skip(!href, "no jobs in the list");
  await page.locator(`a[href="${href}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await settle(page);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("radiogroup", { name: "Work model" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click(); // never saves
  expect(errors).toEqual([]);
});

test("global search opens a result", async ({ page, request }) => {
  const jobs = await (await request.get("/api/v1/jobs", { params: { size: 1 } })).json();
  test.skip(!jobs.items?.length, "no jobs yet");
  const word = String(jobs.items[0].title).split(/\s+/).find((w: string) => w.length >= 3) ?? jobs.items[0].title;
  await page.goto("/");
  await page.getByLabel("Global search").fill(word);
  const result = page.getByRole("option").first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).not.toHaveURL(/\/$/);
});

test("reports draw charts", async ({ page }) => {
  await page.goto("/reports/jobs?range=12m");
  await settle(page);
  await expect(page.getByRole("img", { name: /chart$/ }).first()).toBeVisible();
});
