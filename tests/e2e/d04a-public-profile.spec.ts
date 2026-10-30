// D04a (P08 R07): the profile page and the profile APIs a signed-in visitor
// uses show no email, provider subject or tier. Signed-in pages need the
// development Better Auth switch (Clerk can't be signed into here). With
// CODEDETAILS_E2E_READ_BACKEND=convex the profile comes from
// profiles:getPublicByUsername; otherwise from Supabase.
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";
const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const { a: A } = generateFixtures().personas;
const PRIVATE = [A.profile!.email, A.subject!, "email_address", "user_id", "\"tier\""];

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

test.describe(`D04a public profile (${convexRead ? "Convex" : "Supabase"} read)`, () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  test("the profile APIs return public fields only, and the lookup ignores email addresses", async ({ page }) => {
    await signIn(page, "d04a-api");
    for (const path of [`/api/profiles/${A.profile!.username}`, `/api/profiles/lookup/${A.profile!.username}?includeStats=true`]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text).data.profile.username, path).toBe(A.profile!.username);
      for (const value of PRIVATE) expect(text, `${path} ${value}`).not.toContain(value);
    }
    const byEmail = await page.request.get(`/api/profiles/lookup/${encodeURIComponent(A.profile!.email)}`);
    expect(byEmail.status()).toBe(404);
  });

  test("the profile page shows the user without their email", async ({ page }) => {
    await signIn(page, "d04a-page");
    await page.goto(`/users/${A.profile!.username}`);
    await expect(page.getByRole("heading", { name: A.profile!.username })).toBeVisible();
    const html = await page.content();
    for (const value of PRIVATE) expect(html, value).not.toContain(value);
  });
});
