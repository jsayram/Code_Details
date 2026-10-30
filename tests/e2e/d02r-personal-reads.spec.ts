// D02r-c: with the development Better Auth switch on, the personal pages (my
// projects, favorites, graveyard) and their APIs show the signed-in
// account's own data. A Better Auth login linked to persona A sees A's
// lists; a fresh, unlinked login sees none. With CODEDETAILS_E2E_READ_BACKEND
// =convex too, the lists come from the Convex personal queries; otherwise from
// Supabase through routeViewer (D02r-a). The expectations are the same.
import type { Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";
const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const { a: A } = generateFixtures().personas;

const TITLES = {
  listed: "Fixture Listed Project",
  bob: "Fixture Bob's Project",
  deleted: "Fixture Deleted Recently",
};

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

// D08g4b: the handover is gone; fixtures:linkPersona leaves the same end state.
async function linkToA(email: string) {
  await linkPersona(A.subject!, (await authState(email))!.authUserId);
}

const slugs = async (page: Page, query: string) => {
  const res = await page.request.get(`/api/projects?${query}&limit=50`);
  expect(res.status(), query).toBe(200);
  return ((await res.json()).data as { slug: string }[]).map((p) => p.slug).sort();
};

test.describe.serial(`D02r personal reads (switch on, ${convexRead ? "Convex" : "Supabase"} read)`, () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  test.beforeAll(async () => {
    await releasePersona(A.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(A.subject!);
  });

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("an unlinked login gets empty personal lists and counts", async ({ page }) => {
    await signIn(page, "d02r-unlinked");
    expect(await slugs(page, "userId=x")).toEqual([]);
    expect(await slugs(page, "userId=x&showDeleted=true")).toEqual([]);
    expect(await slugs(page, "userId=x&showFavorites=true")).toEqual([]);
    const counts = await page.request.get("/api/categories/counts?userId=x&deleted=true");
    expect((await counts.json()).data).toEqual({});
    expect(counts.headers()["cache-control"]).toBe("private, no-store");
  });

  test("a login linked to A gets A's lists from the APIs, and nobody else's", async ({ page }) => {
    await linkToA(await signIn(page, "d02r-a-api"));
    const mine = await slugs(page, "userId=x");
    expect(mine).toContain("fixture-listed");
    expect(mine).not.toContain("fixture-bob-project");
    expect(mine).not.toContain("fixture-deleted-recent");
    expect(await slugs(page, "userId=x&showDeleted=true")).toEqual(["fixture-deleted-long-ago", "fixture-deleted-recent"]);
    expect(await slugs(page, "userId=x&showFavorites=true")).toEqual(["fixture-bob-project", "fixture-listed"]);
    const text = JSON.stringify(await (await page.request.get("/api/projects?userId=x&showFavorites=true")).json());
    expect(text).not.toContain(A.profile!.email);
    const counts = await page.request.get("/api/categories/counts?userId=x&deleted=true");
    expect((await counts.json()).data).toEqual({ web: 2 });
    await releasePersona(A.subject!);
  });

  test("the personal pages show A's own projects", async ({ page }) => {
    await linkToA(await signIn(page, "d02r-a-pages"));

    await page.goto("/projects/projects-portfolio");
    await expect(page.getByText(TITLES.listed).first()).toBeVisible();
    await expect(page.getByText(TITLES.bob)).toHaveCount(0);
    await expect(page.getByText(TITLES.deleted)).toHaveCount(0);

    await page.goto("/projects/favorites");
    await expect(page.getByText(TITLES.bob).first()).toBeVisible();
    await expect(page.getByText(TITLES.listed).first()).toBeVisible();

    await page.goto("/projects/deleted");
    await expect(page.getByText(TITLES.deleted).first()).toBeVisible();
    await expect(page.getByText(TITLES.listed)).toHaveCount(0);
  });
});
