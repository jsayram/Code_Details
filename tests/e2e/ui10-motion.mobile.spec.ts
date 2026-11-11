// UI10 on a phone (Pixel 7 emulation in Chrome, not a real device): 10 of the
// 18 particles show, and the sidebar sheet opens on the dialog token.
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, test } from "./support";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("home: 10 particles show on a phone and the pause button fits", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const visible = await page.locator('[data-decorative="code-particles"] .cd-particle').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== "none").length);
  expect(visible).toBe(10);
  const pause = page.getByRole("button", { name: "Pause background animation" });
  const box = (await pause.boundingBox())!;
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("the sidebar sheet opens in 240ms, not 500ms", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/categories");
  await page.locator('[data-shell="header"]').getByRole("button", { name: "Open menu" }).click();
  // The sidebar's sheet content carries data-slot="sidebar" data-mobile="true".
  const sheet = page.locator('[data-mobile="true"]');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0.24s");
});
