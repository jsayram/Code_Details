// D05-b: with both development switches on (Better Auth and the Convex read),
// a signed-in user favorites a project from their portfolio (a Convex-backed
// list; the community list still reads Supabase under the switches), finds it
// on their favorites page and unfavorites it through the confirmation dialog.
// Both clicks go to the favorites:add/remove mutations, which take the user
// from the session. The favorite is removed at the end, so the shared fixture
// set is as it was.
import type { Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const { b: B } = generateFixtures().personas;

const TITLE = "Fixture Bob's Project";

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

const card = (page: Page) => page.locator(".project-card", { hasText: TITLE }).first();
const count = async (page: Page) => Number(await card(page).locator(".favorite-count").textContent());

test.describe.serial("D05 favorites (Better Auth + Convex read)", () => {

  test.beforeAll(async () => {
    await releasePersona(B.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(B.subject!);
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("a user favorites a project, sees it on their favorites page and unfavorites it", async ({ page }) => {
    await linkPersona(B.subject!, (await authState(await signIn(page, "d05-favoriter")))!.authUserId);

    await page.goto("/projects/projects-portfolio");
    await expect(card(page)).toBeVisible();
    const before = await count(page);
    await card(page).getByRole("button", { name: "Add to favorites" }).click();
    await expect(card(page).getByRole("button", { name: "Remove from favorites" })).toBeVisible();
    await expect.poll(() => count(page)).toBe(before + 1);

    // The count came from the server, not just the optimistic update.
    await page.reload();
    await expect.poll(() => count(page)).toBe(before + 1);

    await page.goto("/projects/favorites");
    await expect(card(page)).toBeVisible();
    await card(page).getByRole("button", { name: "Remove from favorites" }).click();
    await page.getByRole("button", { name: "Remove from Favorites" }).click();
    await expect(card(page)).toHaveCount(0);

    await page.goto("/projects/projects-portfolio");
    await expect.poll(() => count(page)).toBe(before);
    await expect(card(page).getByRole("button", { name: "Add to favorites" })).toBeVisible();
  });
});
