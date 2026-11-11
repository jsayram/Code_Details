// S04-URL on a phone (Pixel 7 emulation): a shared link restores the query,
// tab and category; the category filter works by touch; the page fits the
// screen; reload and back keep the search; axe finds nothing in main.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const searchOn = process.env.CODEDETAILS_E2E_SEARCH !== "off";

const field = (page: Page) => page.getByRole("textbox", { name: "Search Code Details" });
const results = (page: Page) => page.getByTestId("project-search-results");
const categorySelect = (page: Page) => results(page).getByRole("combobox", { name: /^Category/ });

async function fits(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.describe("S04-URL /search on a phone", () => {
  test("a shared link restores the search; reload keeps it; clearing empties the address", async ({ page }) => {
    await page.goto("/search?q=fixture&tab=users");
    await expect(field(page)).toHaveValue("fixture");
    await expect(page.getByRole("tab", { name: "Users" })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(field(page)).toHaveValue("fixture");
    await expect(page.getByRole("tab", { name: "Users" })).toHaveAttribute("aria-selected", "true");
    await fits(page);
    await page.getByRole("button", { name: "Clear search" }).tap();
    await expect(page).toHaveURL(/\/search$/);
  });

  test("the category filter by touch, in the address, fitting the screen", async ({ page }) => {
    test.skip(!searchOn, "needs the Convex read with search on (the default)");
    await page.goto("/search?q=fixture");
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();
    await categorySelect(page).tap();
    await page.getByRole("option", { name: "Web Applications" }).tap();
    await expect(page).toHaveURL(/\/search\?q=fixture&category=web$/);
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();
    await fits(page);
    const box = await categorySelect(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await results(page).getByRole("link", { name: /Fixture One Tag/ }).tap();
    await expect(page).toHaveURL(/\/projects\/fixture-one-tag$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=fixture&category=web$/);
    await expect(categorySelect(page)).toHaveAccessibleName(/Category\s+Web Applications/);
  });

  test("axe: no violations with the filter and an empty state", async ({ page }) => {
    test.skip(!searchOn, "needs the Convex read with search on (the default)");
    const found: string[] = [];
    for (const url of ["/search?q=fixture&category=web", "/search?q=fixture&category=mobile"]) {
      await page.goto(url);
      await expect(categorySelect(page)).toBeVisible();
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(WCAG).include("main").analyze();
      found.push(...r.violations.map((v) => `${url} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`));
    }
    expect(found).toEqual([]);
  });
});
