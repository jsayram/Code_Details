// UI05: the shell's phone menu (Pixel 7 emulation in Chrome, not a real device).
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, overflowingContent, test } from "./support";

async function signIn(page: Page, label: string) {
  const headers = { origin: BASE_URL };
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("signed out: the menu button opens the sidebar sheet with Sign In; Escape closes it and returns focus", async ({ page }) => {
  await page.goto("/categories");
  const header = page.locator('[data-shell="header"]');
  await expect(header.getByRole("link", { name: "Code Details" })).toBeVisible();
  const open = header.getByRole("button", { name: "Open menu" });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  expect(Math.round((await open.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await expect.poll(() => overflowingContent(page)).toEqual([]);

  await open.focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator('[data-mobile="true"]');
  await expect(sheet).toBeVisible();
  // While the sheet is open, Radix hides the rest of the page from the accessibility tree.
  await expect(header.locator('button[aria-haspopup="dialog"]')).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Search", "Categories", "Tags", "Users", "Projects", "About Developer"]) {
    await expect(sheet.getByRole("link", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Explore", "Dashboard", "GitHub Scraper"]) await expect(sheet.getByText(name, { exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Sign In" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await sheet.getByRole("link", { name: "Tags", exact: true }).click();
  await expect(page).toHaveURL(/\/tags$/);
});

test("the no-sidebar header's phone menu is hidden while closed and closes on Escape", async ({ page }) => {
  // About, Support and Community use the menu; they're signed-in pages.
  await signIn(page, "ui05-panel");
  await page.goto("/community");
  const header = page.locator('[data-shell="header"]');
  const open = header.getByRole("button", { name: "Open menu" });
  await expect(open).toBeVisible();
  // Closed: the panel's Sign Out isn't visible, so Tab can't land on it.
  const signOut = header.getByRole("button", { name: "Sign Out" }).filter({ visible: true });
  await expect(signOut).toHaveCount(0);
  await open.click();
  await expect(header.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await expect(signOut).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(signOut).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Open menu" })).toBeFocused();
});
