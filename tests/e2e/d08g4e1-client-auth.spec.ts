// D08g4e1: the sidebar's "Sign out", the /auth catch-all pages and
// ProtectedPage follow the Better Auth login instead of calling Clerk.
// Synthetic users only. Skipped in the Clerk mode, where these are still
// Clerk's own controls.
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

const viewer = async (page: Page) => (await (await page.request.get("/api/dev/viewer")).json()) as { viewer: unknown };

test.describe("D08g4e1 client auth controls (Better Auth)", () => {

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("the sidebar's Sign out ends the Better Auth session", async ({ page }) => {
    await signIn(page, "g4e1-sidebar");
    await page.goto("/categories");
    expect((await viewer(page)).viewer).not.toBeNull();
    const button = page.locator('[data-sidebar="footer"]').getByRole("button", { name: "Sign out" });
    await expect(button).toBeVisible();
    await button.click();
    await expect.poll(async () => (await viewer(page)).viewer).toBeNull();
  });

  test("/auth/sign-out signs out and goes home", async ({ page }) => {
    await signIn(page, "g4e1-auth-out");
    await page.goto("/auth/sign-out");
    // The page's decorative particle layer sits over this button and takes
    // pointer clicks (as it did before g4e1; noted for the UI work), so the
    // test presses it from the keyboard.
    const button = page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).last();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await viewer(page)).viewer).toBeNull();
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });

  test("/auth/sign-up shows the app's sign-up form", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator(".cl-rootBox, .cl-signUp-root")).toHaveCount(0);
  });

  test("/auth/sign-in redirects a signed-in user home", async ({ page }) => {
    await signIn(page, "g4e1-auth-in");
    await page.goto("/auth/sign-in");
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });
});
