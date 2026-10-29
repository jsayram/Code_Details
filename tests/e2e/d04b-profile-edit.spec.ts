// D04b: the profile edit over HTTP with the development Better Auth switch.
// Both switches: a fresh sign-up renames its generated handle through
// PUT /api/profiles/[username] (Convex profiles:updateMine), the old handle
// redirects, a refused name and a taken one change nothing. Better Auth with
// the Supabase read: an unlinked login can't edit anyone's profile.
import type { Page } from "@playwright/test";
import { accountRows, authState, freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const { a: A, b: B } = generateFixtures().personas;

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

const put = (page: Page, name: string, data: unknown) =>
  page.request.put(`/api/profiles/${encodeURIComponent(name)}`, { headers: { origin: BASE_URL }, data });

test.describe(`D04b profile edit (${convexRead ? "Convex" : "Supabase"} read)`, () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test("a new account renames its handle; the old one redirects; bad and taken names change nothing", async ({ page }) => {
    test.skip(!convexRead, "the Convex edit runs only with both switches");
    const email = await signIn(page, "d04b-rename");
    const handle = (await accountRows((await authState(email))!.authUserId))!.profiles[0].username;
    const wanted = `e2e-${Date.now().toString(36)}`;

    expect((await put(page, handle, { username: "admin" })).status()).toBe(400);
    expect((await put(page, handle, { username: B.profile!.username.toUpperCase() })).status()).toBe(409);
    expect((await put(page, A.profile!.username, { full_name: "Hijack" })).status()).toBe(404);

    const res = await put(page, handle, { username: wanted, full_name: "Renamed Person" });
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).data.profile).toMatchObject({ username: wanted, full_name: "Renamed Person" });
    expect(text).not.toContain(email);

    const old = await page.request.get(`/api/profiles/${handle}`);
    expect((await old.json()).data).toMatchObject({ redirect: true, currentUsername: wanted });
  });

  test("an unlinked login can't edit a Supabase profile", async ({ page }) => {
    test.skip(convexRead, "Supabase read only");
    await signIn(page, "d04b-unlinked");
    const res = await put(page, A.profile!.username, { full_name: "Hijack" });
    expect([401, 403]).toContain(res.status());
    const after = await page.request.get(`/api/profiles/${A.profile!.username}`);
    expect((await after.json()).data.profile.full_name).toBe("Alice Fixture");
  });
});
