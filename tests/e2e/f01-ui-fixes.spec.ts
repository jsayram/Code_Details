// F01: small frontend fixes found during the backend migration. Synthetic
// users only.
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const headers = { origin: BASE_URL };

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

test.describe("F01 UI fixes", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  // F01-15: the page re-renders whenever the session store updates (it also
  // refreshes when the window gains focus). Each re-render used to hand the
  // form a new empty project, which reset what had been typed.
  test("/projects/new keeps what was typed when the session refreshes", async ({ page }) => {
    await signIn(page, "f01-new-project");
    await page.goto("/projects/new");
    await page.locator("#title").fill("Typed Early Title");
    await page.locator("#slug").fill("typed-early-slug");
    await page.locator("#description").fill("Typed before the page settled.");

    const refreshed = page.waitForResponse((r) => r.url().includes("/api/auth/get-session"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    // Let React commit the re-render (and run its effects) before checking.
    await page.waitForTimeout(500);

    await expect(page.locator("#title")).toHaveValue("Typed Early Title");
    await expect(page.locator("#slug")).toHaveValue("typed-early-slug");
    await expect(page.locator("#description")).toHaveValue("Typed before the page settled.");
  });

  // F01-14: signed-out visitors don't see the "Explore" label or the
  // Dashboard and GitHub Scrapper entries (both need a sign-in); Search and
  // Projects stay. The signed-in sidebar is unchanged. UI05: the entries are
  // links, and UI01 decision 9 renamed Administrator, GitHub Scrapper and My
  // Deleted to Explore, GitHub Scraper and Graveyard.
  const sidebarNav = (page: Page) => page.locator('[data-sidebar="content"]');

  test("signed-out visitors don't see the sidebar's signed-in entries", async ({ page }) => {
    await page.goto("/search");
    const nav = sidebarNav(page);
    await expect(nav.getByRole("link", { name: "Search", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
    await expect(nav.getByText("Explore", { exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "GitHub Scraper", exact: true })).toHaveCount(0);
  });

  // F02: /projects is public, so its sidebar group is too, without the personal lists.
  test("the signed-out Projects group has no personal lists; signed in it does", async ({ page }) => {
    await page.goto("/projects");
    const nav = sidebarNav(page);
    await expect(nav.getByRole("link", { name: "Community Projects", exact: true })).toBeVisible();
    for (const name of ["My Projects Portfolio", "My Favorites", "Graveyard"]) {
      await expect(nav.getByText(name, { exact: true })).toHaveCount(0);
    }
    await signIn(page, "f02-sidebar");
    await page.goto("/projects");
    for (const name of ["My Projects Portfolio", "My Favorites", "Graveyard"]) {
      await expect(nav.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("signed-in users still see the whole group", async ({ page }) => {
    await signIn(page, "f01-sidebar");
    await page.goto("/search");
    const nav = sidebarNav(page);
    await expect(nav.getByText("Explore", { exact: true })).toBeVisible();
    for (const name of ["Dashboard", "Search", "Projects", "GitHub Scraper"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
  });
});
