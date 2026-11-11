// D04b: the profile edit over HTTP with the development Better Auth switch.
// Both switches: a fresh sign-up renames its generated handle through
// PUT /api/profiles/[username] (Convex profiles:updateMine), the old handle
// redirects, a refused name and a taken one change nothing.
import type { Page } from "@playwright/test";
import { accountRows, authState, freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

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

test.describe("D04b profile edit", () => {

  test("a new account renames its handle; the old one redirects; bad and taken names change nothing", async ({ page }) => {
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

  // E03: "an unlinked login can't edit a Supabase profile" went with the Supabase edit;
  // d04b-convex-profile-edit covers another user's handle (not_found, nothing written).
});
