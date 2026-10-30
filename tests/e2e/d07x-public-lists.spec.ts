// D07x: with both development switches on (Better Auth and the Convex read),
// the community list reads Convex. A Better Auth user sees it instead of
// "Please sign in", favorites a project straight from it (the row carries the
// Convex ID favorites:add needs), sees the count survive a reload and
// unfavorites it. Private and deleted projects stay off the list, and a
// signed-in user with no Clerk-era link gets a public portfolio. The favorite is removed at the
// end, so the shared fixture set is as it was.
import type { Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const { a: A, b: B } = generateFixtures().personas;

// Owned by A; B (the signed-in persona) neither owns nor favorites it.
const TITLE = "Fixture One Tag";

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

const card = (page: Page, title = TITLE) => page.locator(".project-card", { hasText: title }).first();
const count = async (page: Page) => Number(await card(page).locator(".favorite-count").textContent());

test.describe.serial("D07x public lists (Better Auth + Convex read)", () => {
  test.skip(!convexRead, "needs CODEDETAILS_E2E_READ_BACKEND=convex");

  test.beforeAll(async () => {
    await releasePersona(B.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(B.subject!);
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("a Better Auth user sees the community list and favorites from it", async ({ page }) => {
    await linkPersona(B.subject!, (await authState(await signIn(page, "d07x-community")))!.authUserId);

    await page.goto("/projects");
    await expect(card(page)).toBeVisible();
    await expect(page.getByText("Please sign in to view projects")).toHaveCount(0);
    await expect(card(page, "Fixture Private Project")).toHaveCount(0);
    await expect(card(page, "Fixture Deleted Recently")).toHaveCount(0);

    const before = await count(page);
    await card(page).getByRole("button", { name: "Add to favorites" }).click();
    await expect(card(page).getByRole("button", { name: "Remove from favorites" })).toBeVisible();
    await expect.poll(() => count(page)).toBe(before + 1);

    // The count and the flag came from the server, not just the optimistic update.
    await page.reload();
    await expect(card(page).getByRole("button", { name: "Remove from favorites" })).toBeVisible();
    await expect.poll(() => count(page)).toBe(before + 1);

    await card(page).getByRole("button", { name: "Remove from favorites" }).click();
    await page.getByRole("button", { name: "Remove from Favorites" }).click();
    await expect(card(page).getByRole("button", { name: "Add to favorites" })).toBeVisible();
    await page.reload();
    await expect.poll(() => count(page)).toBe(before);
  });

  test("an unlinked Better Auth user gets a public portfolio from Convex; signed out stays behind the proxy", async ({ page }) => {
    const url = `/api/projects?showAll=true&username=${A.profile!.username}&limit=50`;
    // /api/projects is not a public route in either mode (src/proxy.ts); unchanged.
    expect((await page.request.get(url)).status()).toBe(401);

    await signIn(page, "d07x-portfolio");
    const res = await page.request.get(url);
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { data: { slug: string; user_id: string; is_mine: boolean; profile: Record<string, unknown> }[] };
    const slugs = body.data.map((r) => r.slug);
    expect(slugs).toContain("fixture-listed");
    expect(slugs).not.toContain("fixture-private");
    expect(slugs).not.toContain("fixture-deleted-recent");
    // Convex rows: no owner ID, no email, and none of them the viewer's.
    expect(body.data.every((r) => r.user_id === "" && r.profile.email_address === null && !r.is_mine)).toBe(true);
  });

  test("a signed-out visitor's shared-projects page lists A's public projects from Convex", async ({ page }) => {
    const api = await page.request.get(`/api/shared-projects/${A.profile!.username}?limit=50`);
    expect(api.status()).toBe(200);
    const body = (await api.json()) as { data: { data: { project: { id: string; slug: string } }[] } };
    const slugs = body.data.data.map((r) => r.project.slug);
    expect(slugs).toContain("fixture-listed");
    expect(slugs).not.toContain("fixture-private");
    // A Convex ID, not a Supabase UUID: the grid really came from Convex.
    expect(body.data.data[0].project.id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);

    await page.goto(`/shared-projects/${A.profile!.username}`);
    await expect(page.getByText("Fixture One Tag").first()).toBeVisible();
    await expect(page.getByText("Fixture Private Project")).toHaveCount(0);
  });

  test("the tag list comes from Convex", async ({ page }) => {
    await signIn(page, "d07x-tags");
    await page.goto("/tags");
    await expect(page.getByText(/^Rust\s*\d+$/).first()).toBeVisible();
  });

  test("a Better Auth user's click on a card's tag opens the tag page instead of a sign-in toast", async ({ page }) => {
    await signIn(page, "d07x-tag-click");
    await page.goto("/projects");
    await card(page).getByText("#C#", { exact: true }).click();
    await expect(page).toHaveURL(/\/tags\/C%23$/);
    await expect(page.getByText("You have to sign in to browse projects by tags")).toHaveCount(0);
  });
});
