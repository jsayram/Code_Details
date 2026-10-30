// D08g4e3: the pages follow the Better Auth login instead of Clerk's.
// - /dashboard's "Unfavorite" (on a favorited project that was deleted) reads
//   Clerk's user before and silently did nothing under Better Auth; now it sends
//   the remove action. The action is intercepted (and fails on purpose), so the
//   shared fixture favorite stays as it is.
// Synthetic users only; persona B is linked for the test and released after.
import type { Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";
const { b: B } = generateFixtures().personas;
const headers = { origin: BASE_URL };

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

test.describe.serial("D08g4e3 pages (Better Auth)", () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  test.beforeAll(async () => {
    await releasePersona(B.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(B.subject!);
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("/dashboard's Unfavorite sends the remove action", async ({ page }) => {
    await linkPersona(B.subject!, (await authState(await signIn(page, "g4e3-dashboard")))!.authUserId);
    await page.goto("/dashboard");
    const unfavorite = page.getByText("Unfavorite", { exact: true }).first();
    await expect(unfavorite).toBeVisible({ timeout: 30_000 });

    const actions: string[] = [];
    await page.route("**/dashboard", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actions.push(request.postData() ?? "");
        await route.abort();
        return;
      }
      await route.continue();
    });
    await unfavorite.click();
    await expect.poll(() => actions.length).toBeGreaterThan(0);
    await expect(page.getByText("Failed to remove favorite")).toBeVisible();
  });

});
