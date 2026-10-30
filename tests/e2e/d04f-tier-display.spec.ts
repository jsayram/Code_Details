// D04f: the tier chip on the personal pages shows the account's real tier.
// Before D04f the client read `result.tier` from a route that answers
// `{ success, data: { tier } }`, so every account showed "free member".
// Signed-in pages need the development Better Auth switch (no Clerk session
// can be made here). With CODEDETAILS_D04F_SHOTS set to a folder, each page
// is also saved as a screenshot there (before/after evidence for Jose).
import path from "node:path";
import type { Page } from "@playwright/test";
import { makeFunctionReference } from "convex/server";
import { adminClient } from "../fixtures/convex";
import { authState, freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";
const shots = process.env.CODEDETAILS_D04F_SHOTS;
const setTier = makeFunctionReference<"mutation", { authUserId: string; tier: string }, null>("fixtures:setTier");
const PAGES = [
  { path: "/projects/favorites", name: "favorites" },
  { path: "/projects/deleted", name: "deleted" },
  { path: "/projects/projects-portfolio", name: "portfolio" },
];

async function signInWithTier(page: Page, tier: "pro" | "diamond") {
  const email = syntheticEmail(`d04f-${tier}`);
  const headers = { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: `Synthetic ${tier}` } })).status()).toBe(200);
  await verifyEmail(email);
  await adminClient().mutation(setTier, { authUserId: (await authState(email))!.authUserId, tier });
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

test.describe(`D04f tier display (${process.env.CODEDETAILS_E2E_READ_BACKEND === "convex" ? "Convex" : "Supabase"} read)`, () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  for (const tier of ["pro", "diamond"] as const) {
    test(`a ${tier} account sees "${tier} member" on its personal pages`, async ({ page }) => {
      await signInWithTier(page, tier);
      for (const p of PAGES) {
        await page.goto(p.path);
        await expect(page.getByText(/\b(free|pro|diamond) member\b/i).first()).toBeVisible();
        if (shots) {
          await page.screenshot({ path: path.join(shots, `${tier}-${p.name}.png`) });
          await page.getByText(/\b(free|pro|diamond) member\b/i).first().locator("xpath=ancestor::div[3]").screenshot({ path: path.join(shots, `${tier}-${p.name}-banner.png`) });
        }
        await expect.soft(page.getByText(`${tier} member`, { exact: false }).first(), p.path).toBeVisible({ timeout: 5_000 });
      }
    });
  }
});
