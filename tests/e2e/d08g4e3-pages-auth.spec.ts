// D08g4e3: the pages follow the Better Auth login instead of Clerk's.
// - /dashboard's "Unfavorite" (on a favorited project that was deleted) reads
//   Clerk's user before and silently did nothing under Better Auth; now it sends
//   the remove action. The action is intercepted (and fails on purpose), so the
//   shared fixture favorite stays as it is.
// - DEF-G4E3-HANDLE (g4f1): the dashboard's profile editor gets the session's
//   handle from the server and saves under it; typing in the form sticks.
// Synthetic users only; persona B is linked for the tests and released after;
// its handle is renamed back at the end.
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


  test("/dashboard's profile editor saves under the session's handle (DEF-G4E3-HANDLE)", async ({ page }) => {
    await linkPersona(B.subject!, (await authState(await signIn(page, "g4e3-handle")))!.authUserId);
    // Persona B's fixture handle, the same in Supabase and Convex.
    const original = B.profile!.username;
    const renamed = `${original}-g4f`.slice(0, 30);
    const exists = async (handle: string) => (await page.request.get(`/api/profiles/${encodeURIComponent(handle)}`)).status() === 200;
    let saved = false;
    try {
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Edit Profile" }).click();
      const username = page.locator("label", { hasText: "Username" }).locator("xpath=following-sibling::input[1]");
      await expect(username).toHaveValue(original);
      await username.fill(renamed);
      await expect(username).toHaveValue(renamed); // the form keeps what was typed
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page.getByText("Profile updated successfully")).toBeVisible();
      saved = true;
      await expect.poll(() => exists(renamed)).toBe(true);
    } finally {
      if (saved || (await exists(renamed))) {
        const res = await page.request.put(`/api/profiles/${encodeURIComponent(renamed)}`, { headers, data: { username: original } });
        expect(res.status()).toBe(200);
      }
    }
  });
});
