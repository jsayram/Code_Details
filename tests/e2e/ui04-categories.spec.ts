// UI04: /categories, the first screen on the UI03 foundations. Its loading,
// error and empty states are forced in the browser's network layer, so no app
// code or data changes. Synthetic data only.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, overflowingContent, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const COUNTS = /\/api\/categories\/counts(\?|$)/;
const PARTIAL = { web: 12, "ai-ml": 1 };

const serveCounts = (page: Page, data: Record<string, number>) =>
  page.route(COUNTS, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) }));

const failCounts = (page: Page) =>
  page.route(COUNTS, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { detail: "Synthetic failure" } }) }));

const card = (page: Page, key: string) => page.locator(`[data-category="${key}"]`);

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("one h1 and one main, inside the foundations scope", async ({ page }) => {
  await serveCounts(page, PARTIAL);
  await page.goto("/categories");
  await expect(page.getByRole("heading", { level: 1, name: "Browse All Categories" })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator(".cd-foundations h1")).toHaveCount(1);
  // UI05: the shared shell carries its own scope, beside the page's.
  await expect(page.locator('header.cd-foundations[data-shell="header"]')).toHaveCount(1);
});

test("counts: a category with projects opens by keyboard; one without stays shut", async ({ page }) => {
  await serveCounts(page, PARTIAL);
  await page.goto("/categories");
  await expect(card(page, "web")).toContainText("12 projects");
  await expect(card(page, "ai-ml")).toContainText("1 project");
  const none = card(page, "mobile").getByRole("button", { name: "No projects yet" });
  await expect(none).toBeDisabled();
  await card(page, "mobile").click();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/categories$/);

  const browse = page.getByRole("button", { name: "Browse Web Applications" });
  await expect(browse).toBeEnabled();
  // Pill-shaped and 44px tall (UI03 decisions 2 and 3).
  const box = (await browse.boundingBox())!;
  expect(Math.round(box.height)).toBe(44);
  expect(await browse.evaluate((b) => parseFloat(getComputedStyle(b).borderTopLeftRadius))).toBeGreaterThan(box.height / 2 - 1);
  await browse.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/categories\/web$/);
});

test("a click anywhere on an open card opens it", async ({ page }) => {
  await serveCounts(page, PARTIAL);
  await page.goto("/categories");
  await card(page, "web").getByRole("heading", { name: "Web Applications" }).click();
  await expect(page).toHaveURL(/\/categories\/web$/);
});

test("loading: placeholders instead of zeros, announced as busy", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(COUNTS, async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: PARTIAL }) });
  });
  await page.goto("/categories");
  await expect(page.getByRole("status")).toHaveText("Loading project counts");
  await expect(page.locator("ul[aria-busy=true]")).toHaveCount(1);
  await expect(page.getByText("No projects yet")).toHaveCount(0);
  await expect(page.getByText(/^0 projects$/)).toHaveCount(0);
  release();
  await expect(card(page, "web")).toContainText("12 projects");
  await expect(page.locator("ul[aria-busy=true]")).toHaveCount(0);
});

test("error: says the counts failed, keeps every category open, and Try again recovers", async ({ page }) => {
  let calls = 0;
  await page.route(COUNTS, (route) =>
    ++calls === 1
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { detail: "Synthetic failure" } }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: PARTIAL }) }),
  );
  await page.goto("/categories");
  const alert = page.getByRole("alert").filter({ hasText: "Project counts didn't load" });
  await expect(alert).toBeVisible();
  // A failure is not an empty site: nothing claims zero projects.
  await expect(page.getByText("No projects yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Browse Mobile Applications" })).toBeEnabled();
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0);
  await expect(card(page, "web")).toContainText("12 projects");
  await expect(card(page, "mobile").getByRole("button", { name: "No projects yet" })).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds nothing in ${theme}, in the ready, error and loading states`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    for (const state of ["ready", "error", "loading"] as const) {
      await page.unroute(COUNTS);
      if (state === "ready") await serveCounts(page, PARTIAL);
      else if (state === "error") await failCounts(page);
      else await page.route(COUNTS, () => new Promise(() => {}));
      await page.goto("/categories");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (state === "ready") await expect(card(page, "web")).toContainText("12 projects");
      if (state === "error") await expect(page.getByRole("alert").filter({ hasText: "Project counts didn't load" })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.map((v) => `${state}: ${v.id} (${v.nodes.length})`)).toEqual([]);
    }
  });
}

test("no sideways overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await serveCounts(page, PARTIAL);
  await page.goto("/categories");
  await expect(card(page, "web")).toContainText("12 projects");
  await expect.poll(() => overflowingContent(page)).toEqual([]);
});

test("the click spinner keeps turning with reduced motion on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await serveCounts(page, PARTIAL);
  // Hold the category page so the spinner stays up long enough to measure.
  await page.route(/\/categories\/web/, () => new Promise(() => {}));
  await page.goto("/categories");
  await page.getByRole("button", { name: "Browse Web Applications" }).click();
  const spinner = card(page, "web").locator(".animate-spin");
  await expect(spinner).toBeVisible();
  const style = await spinner.evaluate((el) => {
    const s = getComputedStyle(el);
    return { duration: s.animationDuration, count: s.animationIterationCount };
  });
  expect(style.count).toBe("infinite");
  expect(parseFloat(style.duration)).toBeGreaterThan(0.1);
});
