// D04c (P08 R26): the profile page's numbers, signed in through the
// development Better Auth switch, against the fixture spec. Persona B is used
// because no other spec changes B's projects or favorites. B favorited one
// active project and one deleted one; only the active one counts now.
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { expectedProfileStats } from "../support/profile-stats-spec";
import { BASE_URL, expect, test } from "./support";

const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const set = generateFixtures();
const B = set.personas.b;

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

test.describe(`D04c profile stats (${convexRead ? "Convex" : "Supabase"} read)`, () => {

  test("the profile page shows B's active projects and only the favorites on active projects", async ({ page }) => {
    const want = expectedProfileStats(set, "b", !convexRead);
    await signIn(page, "d04c-stats");
    const res = await page.request.get(`/api/profiles/lookup/${B.profile!.username}?includeStats=true`);
    expect((await res.json()).data.stats).toMatchObject({ activeProjects: want.activeProjects, projectsFavorited: want.projectsFavorited, totalLikes: want.totalLikes });

    await page.goto(`/users/${B.profile!.username}`);
    const card = (title: string) => page.locator("div.rounded-xl, [class*=card]").filter({ hasText: title }).locator(".text-3xl").first();
    await expect(card("Active Projects")).toHaveText(String(want.activeProjects));
    await expect(card("Favorites Given")).toHaveText(String(want.projectsFavorited));
  });
});
