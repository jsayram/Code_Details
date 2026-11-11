// S04-URL: /search keeps its query, tab and project category in the address.
// Reload, back/forward and a shared link restore them; typing replaces the
// history entry instead of adding one; an empty query leaves a bare /search;
// bad values are dropped; user text is never rendered as HTML. The category
// filter goes through /api/search's category=, which refuses unknown keys.
// Synthetic data only (every fixture project is in "web").
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const searchOn = process.env.CODEDETAILS_E2E_SEARCH !== "off";

const field = (page: Page) => page.getByRole("textbox", { name: "Search Code Details" });
const results = (page: Page) => page.getByTestId("project-search-results");
const categorySelect = (page: Page) => results(page).getByRole("combobox", { name: /^Category/ });
const search = (page: Page) => new URL(page.url()).search;

async function mainAxe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(WCAG).include("main").analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("S04-URL /search address", () => {
  test("typing writes q with replace, reload restores it, clearing removes it", async ({ page }) => {
    await page.goto("/search");
    const before = await page.evaluate(() => history.length);
    await field(page).pressSequentially("fixt", { delay: 30 });
    await field(page).pressSequentially("ure", { delay: 30 });
    await expect(page).toHaveURL(/\/search\?q=fixture$/);
    expect(await page.evaluate(() => history.length)).toBe(before);
    await expect(page.getByText(/Found \d+ results/)).toBeVisible();

    await page.reload();
    await expect(field(page)).toHaveValue("fixture");
    await expect(field(page)).toBeFocused();
    await expect(page.getByText(/Found \d+ results/)).toBeVisible();
    if (searchOn) await expect(results(page).getByText("Fixture One Tag")).toBeVisible();

    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(field(page)).toHaveValue("");
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });

  test("a shared link restores the query, the tab and the results", async ({ page }) => {
    await page.goto("/search?q=fixture&tab=tags");
    await expect(field(page)).toHaveValue("fixture");
    await expect(page.getByRole("tab", { name: "Tags" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Browse All Tags" })).toBeVisible();
    if (searchOn) await expect(results(page).getByText("Fixture One Tag")).toBeVisible();

    await page.getByRole("tab", { name: "Users" }).click();
    await expect(page).toHaveURL(/\/search\?q=fixture&tab=users$/);
    await page.getByRole("tab", { name: "All" }).click();
    await expect(page).toHaveURL(/\/search\?q=fixture$/);
  });

  test("back and forward return to the search as it was", async ({ page }) => {
    test.skip(!searchOn, "needs project results to open a project");
    await page.goto("/search");
    await field(page).fill("fixture");
    await page.getByRole("tab", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/search\?q=fixture&tab=categories$/);
    await results(page).getByRole("link", { name: /Fixture One Tag/ }).click();
    await expect(page).toHaveURL(/\/projects\/fixture-one-tag$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=fixture&tab=categories$/);
    await expect(field(page)).toHaveValue("fixture");
    await expect(page.getByRole("tab", { name: "Categories" })).toHaveAttribute("aria-selected", "true");
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/projects\/fixture-one-tag$/);
    await page.goBack();
    await expect(field(page)).toHaveValue("fixture");
  });

  test("a link to /search from the sidebar resets the page", async ({ page }) => {
    await page.goto("/search?q=fixture&tab=tags");
    await expect(field(page)).toHaveValue("fixture");
    // A client-side navigation to bare /search, as the sidebar's Search link does.
    await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/search"]'))[0];
      a.click();
    });
    await expect(page).toHaveURL(/\/search$/);
    await expect(field(page)).toHaveValue("");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });

  test("bad values are dropped and the address is cleaned", async ({ page }) => {
    const long = "fixture" + "x".repeat(400);
    await page.goto(`/search?q=${long}&tab=admin&category=nope&ref=keep`);
    await expect(field(page)).toHaveValue(long.slice(0, 200));
    await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => search(page)).toBe(`?q=${long.slice(0, 200)}&ref=keep`);

    await page.goto("/search?tab=users&category=web");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect.poll(() => search(page)).toBe("");
  });

  test("user text from the address is shown as text, never as HTML", async ({ page }) => {
    let dialog = false;
    page.on("dialog", (d) => {
      dialog = true;
      void d.dismiss();
    });
    const payload = `<img src=x onerror=alert(1)>`;
    await page.goto(`/search?q=${encodeURIComponent(payload)}`);
    await expect(field(page)).toHaveValue(payload);
    await expect(page.getByText(/Found \d+ results/)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main img[src='x']")).toHaveCount(0);
    expect(dialog).toBe(false);
  });
});

test.describe("S04-URL project category filter", () => {
  test.skip(!searchOn, "needs the Convex read with search on (the default)");

  test("choosing a category filters through the API and lands in the address", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/search?")) asked.push(new URL(r.url()).searchParams.get("category") ?? "");
    });
    await page.goto("/search?q=fixture");
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();
    // The facets say only "web" has matches; the others stay listed, disabled.
    await categorySelect(page).click();
    await expect(page.getByRole("option", { name: /Mobile Applications/ })).toHaveAttribute("data-disabled", "");
    await page.getByRole("option", { name: "Web Applications" }).click();
    await expect(page).toHaveURL(/\/search\?q=fixture&category=web$/);
    await expect(categorySelect(page)).toHaveAccessibleName(/Category\s+Web Applications/);
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();
    expect(asked).toContain("web");

    await page.reload();
    await expect(categorySelect(page)).toHaveAccessibleName(/Category\s+Web Applications/);
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();
  });

  test("keyboard: the select opens and chooses with the keys", async ({ page }) => {
    await page.goto("/search?q=fixture&category=web");
    await expect(results(page).getByText("Fixture One Tag")).toBeVisible();
    await categorySelect(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "All Categories" })).toBeVisible();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "All Categories" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=fixture$/);
    await expect(categorySelect(page)).toBeFocused();
  });

  test("a category with no matches shows its empty state; clearing the query drops it", async ({ page }) => {
    await page.goto("/search?q=fixture&category=mobile");
    await expect(results(page).getByText("No projects in Mobile Applications match “fixture”.")).toBeVisible();
    await expect(categorySelect(page)).toHaveAccessibleName(/Category\s+Mobile Applications/);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/search$/);
    await field(page).fill("fixture");
    await expect(page).toHaveURL(/\/search\?q=fixture$/);
    await expect(categorySelect(page)).toHaveAccessibleName(/Category\s+All Categories/);
  });

  test("the API still refuses an unknown category", async ({ page }) => {
    const res = await page.request.get("/api/search?q=fixture&category=nope");
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("unknown_filter");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe: no violations with the filter and an empty state (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const found: string[] = [];
      for (const url of ["/search?q=fixture&tab=tags&category=web", "/search?q=fixture&category=mobile"]) {
        await page.goto(url);
        await expect(categorySelect(page)).toBeVisible();
        await page.waitForLoadState("networkidle");
        found.push(...(await mainAxe(page)).map((v) => `${url} ${v}`));
      }
      expect(found).toEqual([]);
    });
  }
});
