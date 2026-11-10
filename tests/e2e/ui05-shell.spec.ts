// UI05: the shared shell (header, sidebar, footer) on the design foundations.
// Synthetic accounts and data only.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SHELL = ['[data-shell="header"]', '[data-shell="footer"]', '[data-slot="sidebar-container"]', '[data-shell="skip"]'];
const SIGNED_IN_ONLY = ["Explore", "Dashboard", "GitHub Scraper", "My Projects Portfolio", "My Favorites", "Graveyard"];
const headers = { origin: BASE_URL };

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

async function shellAxe(page: Page) {
  let b = new AxeBuilder({ page }).withTags(WCAG);
  for (const s of SHELL) b = b.include(s);
  return (await b.analyze()).violations.map((v) => v.id);
}

const nav = (page: Page) => page.locator('[data-sidebar="content"]');

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("the shell scopes only itself; unadopted page content stays outside", async ({ page }) => {
  // UI07: /tags and /search adopted the foundations, so the shell's own parts
  // are checked on /search and the unadopted content on home.
  await page.goto("/search");
  await expect(page.locator('header.cd-foundations[data-shell="header"]')).toHaveCount(1);
  await expect(page.locator('footer.cd-foundations[data-shell="footer"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="sidebar-container"].cd-foundations')).toHaveCount(1);
  await page.goto("/");
  await expect(page.locator('header.cd-foundations[data-shell="header"]')).toHaveCount(1);
  // Home hasn't adopted the foundations: nothing outside the shell is scoped,
  // except UI10's particle pause button ([data-home-control]).
  const scopedContent = await page.evaluate(() =>
    [...document.querySelectorAll(".cd-foundations")].filter((el) => !el.closest('[data-shell], [data-slot="sidebar-container"], [data-mobile="true"], .cd-theme-switch, [data-home-control]')).length,
  );
  expect(scopedContent).toBe(0);
});

test("signed out: no signed-in entries in the server HTML or while the session loads", async ({ page, browser }) => {
  const res = await page.request.get("/projects");
  const html = await res.text();
  for (const name of SIGNED_IN_ONLY) expect(html).not.toContain(`>${name}<`);

  const ctx = await browser.newContext({ baseURL: BASE_URL });
  await ctx.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  const held = await ctx.newPage();
  await held.route("**/api/auth/get-session*", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await held.goto("/projects", { waitUntil: "domcontentloaded" });
  await expect(nav(held).getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  for (const name of SIGNED_IN_ONLY) await expect(nav(held).getByText(name, { exact: true })).toHaveCount(0);
  await ctx.close();
});

test("signed-in-only routes still redirect signed-out requests on the server", async ({ page }) => {
  for (const path of ["/dashboard", "/dashboard/admin", "/github-scrapper", "/github-scrapper/my-docs"]) {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(res.headers()["location"], path).toContain("/sign-in");
  }
});

test("keyboard: skip link first, then the logo and entries as links; theme switch flips", async ({ page }) => {
  await page.goto("/categories");
  await expect(nav(page).getByRole("link", { name: "Search", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  const toggle = page.getByRole("switch", { name: "Toggle theme" });
  await toggle.focus();
  const before = await toggle.getAttribute("aria-checked");
  await page.keyboard.press("Space");
  await expect(toggle).not.toHaveAttribute("aria-checked", before!);
  // A visible focus ring on the switch and the nav links.
  for (const el of [toggle, nav(page).getByRole("link", { name: "Search", exact: true })]) {
    await el.focus();
    expect(await el.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
  }
  await expect(nav(page).getByRole("link", { name: "Categories", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-slot="sidebar-container"]').getByRole("link", { name: "Code Details" })).toHaveAttribute("href", "/");
});

test("signed in: renamed entries, account menu and axe clean in both themes", async ({ page }) => {
  await signIn(page, "ui05-shell");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/projects");
    await expect(nav(page).getByText("Explore", { exact: true })).toBeVisible();
    for (const name of ["Dashboard", "GitHub Scraper"]) await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Graveyard", exact: true })).toHaveAttribute("href", "/projects/deleted");
    await expect(page.getByRole("button", { name: "Open account menu" }).filter({ visible: true })).toHaveCount(1);
    expect(await shellAxe(page)).toEqual([]);
  }
});

test("signed out: axe finds nothing in the shell in either theme", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/search");
    await expect(nav(page).getByRole("link", { name: "Search", exact: true })).toBeVisible();
    expect(await shellAxe(page)).toEqual([]);
  }
});

test("back to top is a named 44px pill", async ({ page }) => {
  await page.goto("/tags");
  const back = page.getByRole("button", { name: "Back to top" });
  await back.scrollIntoViewIfNeeded();
  const box = (await back.boundingBox())!;
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
