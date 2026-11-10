// UI08 on an emulated phone (Pixel 7 in Chrome, not a real device).
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, overflowingContent, test } from "./support";

async function signUpFresh(page: Page, label: string) {
  const headers = { origin: BASE_URL };
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Creator Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("/dashboard fits the phone: no sideways scroll, no fixed-height boxes, one main", async ({ page }) => {
  await signUpFresh(page, "ui08-phone-dash");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Personal Analytics Dashboard" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  // UI02 measured over 6,000px here; the empty account's page is well under that now.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(5000);
  const refresh = page.getByRole("button", { name: "Refresh dashboard data" });
  expect(Math.round((await refresh.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
});

test("/projects/new on the phone: errors beside fields, 44px actions, nothing off screen", async ({ page }) => {
  await signUpFresh(page, "ui08-phone-new");
  await page.goto("/projects/new");
  await expect(page.locator("#title")).toBeVisible();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
  const create = page.getByRole("button", { name: "Create Project" });
  expect(Math.round((await create.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await create.tap();
  await expect(page.getByRole("alert").filter({ hasText: "The project wasn't created" })).toBeVisible();
  await expect(page.locator("#title")).toBeFocused();
  await expect.poll(() => overflowingContent(page)).toEqual([]);
});
