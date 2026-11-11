// UI06 on an emulated phone (Pixel 7 in Chrome, not a real device).
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, overflowingContent, test } from "./support";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("public profile: one column, no sideways overflow, a tap opens a project", async ({ page }) => {
  await page.goto("/shared-projects/fixture-alice");
  const cards = page.locator("[data-project-card]");
  const listed = cards.filter({ hasText: "Fixture Listed Project" }).first();
  await expect(listed).toBeVisible();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.round(a!.x)).toBe(Math.round(b!.x));
  // View Project and the share button are 44px pills.
  const view = listed.getByRole("link", { name: /View Project/ });
  expect(Math.round((await view.boundingBox())!.height)).toBe(44);
  await listed.getByRole("link", { name: "Fixture Listed Project", exact: true }).tap();
  await expect(page).toHaveURL(/\/projects\/fixture-listed$/);
});

test("project page: the contents button opens the list, Escape closes it and focus returns", async ({ page }) => {
  await page.goto("/projects/fixture-unicode");
  await expect(page.locator("h1")).toBeVisible();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const fab = page.getByRole("button", { name: "Toggle table of contents" }).last();
  await fab.tap();
  const menu = page.locator("#toc-menu-mobile");
  await expect(menu.getByRole("button", { name: "About" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(fab).toBeFocused();
});
