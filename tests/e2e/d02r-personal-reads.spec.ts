// D02r-c: with the development Better Auth switch on, the personal pages (my
// projects, favorites, graveyard) and their APIs show the signed-in
// account's own data. A Better Auth login handed over to persona A sees A's
// lists; a fresh, unlinked login sees none. With CODEDETAILS_E2E_READ_BACKEND
// =convex too, the lists come from the Convex personal queries; otherwise from
// Supabase through routeViewer (D02r-a). The expectations are the same.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { SYNTHETIC_PASSWORD, freshClientIp, releasePersona, syntheticEmail, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const { a: A } = generateFixtures().personas;
const SECRET_FILE = path.resolve(__dirname, "../../.test-runtime/convex/handover-secret");

const TITLES = {
  listed: "Fixture Listed Project",
  bob: "Fixture Bob's Project",
  deleted: "Fixture Deleted Recently",
};

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

async function handOverToA(page: Page) {
  const { token } = (await (await page.request.get("/api/auth/convex/token")).json()) as { token: string };
  const res = await fetch(`${TEST_CONVEX_SITE_URL}/account/handover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-codedetails-handover-secret": fs.readFileSync(SECRET_FILE, "utf8").trim() },
    body: JSON.stringify({ clerkSubject: A.subject }),
  });
  expect(res.status).toBe(200);
}

const slugs = async (page: Page, query: string) => {
  const res = await page.request.get(`/api/projects?${query}&limit=50`);
  expect(res.status(), query).toBe(200);
  return ((await res.json()).data as { slug: string }[]).map((p) => p.slug).sort();
};

test.describe.serial(`D02r personal reads (switch on, ${convexRead ? "Convex" : "Supabase"} read)`, () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test.beforeAll(async () => {
    await releasePersona(A.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(A.subject!);
  });

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": freshClientIp() });
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

  test("a login handed over to A gets A's lists from the APIs, and nobody else's", async ({ page }) => {
    await signIn(page, "d02r-a-api");
    await handOverToA(page);
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
    await signIn(page, "d02r-a-pages");
    await handOverToA(page);

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
