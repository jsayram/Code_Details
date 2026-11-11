// UI09 on a phone (Pixel 7 emulation): the auth card fits with 44px controls,
// a wrong password stays on screen, and not-found and About fit the width.
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, horizontalOverflow, overflowingContent, test } from "./support";

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

test("phone: sign-in fits, its controls are 44px, and a wrong password stays in view", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Code Details");
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await overflowingContent(page)).toEqual([]);
  for (const control of [page.getByLabel("Email address"), page.getByLabel("Password"), page.getByRole("button", { name: "Continue", exact: true }), page.getByRole("button", { name: "Continue with GitHub" }), page.getByRole("link", { name: "Forgot password?" })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
  await page.getByLabel("Email address").fill(syntheticEmail("ui09-phone-nobody"));
  await page.getByLabel("Password").fill("not-the-Password-1");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toHaveText("Email or password is incorrect.");
  await expect(alert).toBeInViewport();
});

test("phone: not-found and About fit the width", async ({ page }) => {
  await signIn(page, "ui09-phone");
  for (const path of ["/ui09-no-such-page", "/about", "/support"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await horizontalOverflow(page), path).toBe(0);
    expect(await overflowingContent(page), path).toEqual([]);
  }
});
