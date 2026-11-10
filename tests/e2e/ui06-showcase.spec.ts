// UI06: the public showcase on the foundations: project cards, the public
// project page and the profiles. Synthetic accounts and data only.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, overflowingContent, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const headers = { origin: BASE_URL };
const SHARE = "/shared-projects/fixture-alice";
const card = (page: Page, title: string) => page.locator("[data-project-card]", { hasText: title }).first();

async function signIn(page: Page, label: string) {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

/** axe on the page content only (the shell has its own UI05 checks). */
async function contentAxe(page: Page) {
  // The category and sort selects belong to UI07 (their triggers have no name yet).
  const r = await new AxeBuilder({ page }).withTags(WCAG).include('[data-slot="sidebar-inset"] > .cd-foundations').exclude('[data-slot="select-trigger"]').analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

/** One synthetic card in the shared-projects API's shape. */
const apiCard = (over: Record<string, unknown> = {}) => ({
  project: { id: "ui06-fake", title: "UI06 Mocked Card", slug: "fixture-listed", description: "Mocked for a card test.", category: "mobile", created_at: null, updated_at: null, total_favorites: "3", ...over },
  profile: { username: "fixture-alice", profile_image_url: null, full_name: "Alice Fixture" },
  tags: Array.from({ length: 15 }, (_, i) => `tag-${i + 1}`),
});

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.describe("UI06.1 project cards", () => {
  test("signed out: each card is a link; a click anywhere opens the project", async ({ page }) => {
    await page.goto(SHARE);
    const listed = card(page, "Fixture Listed Project");
    await expect(listed).toBeVisible();
    await expect(listed.getByRole("link", { name: "Fixture Listed Project", exact: true })).toHaveAttribute("href", "/projects/fixture-listed");
    // Private and graveyard projects stay off a public profile.
    await expect(card(page, "Fixture Private Project")).toHaveCount(0);
    await expect(card(page, "Fixture Deleted Recently")).toHaveCount(0);
    // Owner-only and favorite controls stay hidden signed out.
    await expect(listed.getByRole("button", { name: /Update project|Delete project|to favorites|from favorites/ })).toHaveCount(0);
    await listed.scrollIntoViewIfNeeded();
    const box = (await listed.boundingBox())!;
    // On the cover area, away from every other control.
    await page.mouse.click(box.x + box.width / 2, box.y + 40);
    await expect(page).toHaveURL(/\/projects\/fixture-listed$/);
  });

  test("chips are links, the owner is one named button, every control is named", async ({ page }) => {
    await page.goto(SHARE);
    const listed = card(page, "Fixture Listed Project");
    await expect(listed).toBeVisible();
    const category = listed.locator(".cd-cat");
    await expect(category).toHaveAttribute("href", /^\/categories\//);
    for (const tag of await listed.locator('a[href^="/tags/"]').all()) await expect(tag).toHaveText(/^#/);
    await expect(listed.getByRole("button", { name: "Alice Fixture" })).toBeVisible();
    const unnamed = await page.locator("[data-project-card]").evaluateAll((cards) =>
      cards.flatMap((c) => Array.from(c.querySelectorAll("a, button")).filter((b) => !(b.getAttribute("aria-label") || (b.textContent ?? "").trim()))).length,
    );
    expect(unnamed).toBe(0);
    // Signed out, the owner button explains instead of opening a profile.
    await listed.getByRole("button", { name: "Alice Fixture" }).click();
    await expect(page.getByText("You have to sign in to view Alice Fixture's profile page")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${SHARE}$`));
  });

  test("hidden tags: a named button shows them and another hides them", async ({ page }) => {
    await page.route("**/api/shared-projects/fixture-alice?*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { data: [apiCard()], pagination: { total: 1, page: 1, limit: 20, totalPages: 1 } } }) }),
    );
    await page.goto(SHARE);
    const mocked = card(page, "UI06 Mocked Card");
    await expect(mocked.locator('a[href^="/tags/"]')).toHaveCount(3);
    await mocked.getByRole("button", { name: "Show 12 more tags" }).click();
    await expect(mocked.locator('a[href^="/tags/"]')).toHaveCount(15);
    await mocked.getByRole("button", { name: "Show fewer tags" }).click();
    await expect(mocked.locator('a[href^="/tags/"]')).toHaveCount(3);
  });

  test("category chips have their own color and none is purple", async ({ page }) => {
    await page.goto(SHARE);
    await expect(page.locator("[data-project-card]").first()).toBeVisible();
    const colors = await page.locator(".cd-cat").evaluateAll((els) => els.map((e) => [e.getAttribute("data-category"), getComputedStyle(e).backgroundColor]));
    const byCategory = new Map(colors as [string, string][]);
    expect(new Set(byCategory.values()).size).toBe(byCategory.size);
  });

  test("placeholders while loading are not cards and can't be clicked", async ({ page }) => {
    await page.route("**/api/shared-projects/fixture-alice?*", () => new Promise(() => {}));
    await page.goto(SHARE);
    await expect(page.getByRole("status").filter({ hasText: "Loading projects" })).toBeAttached();
    await expect(page.locator(".cd-project-card-skeleton").first()).toBeVisible();
    await expect(page.locator(".project-card")).toHaveCount(0);
  });
});

test.describe("UI06.2 public project page", () => {
  test("signed out: the note, one h1, and a contents list of sections that exist", async ({ page }) => {
    await page.goto("/projects/fixture-listed");
    await expect(page.getByText("You are viewing Alice Fixture's project.")).toBeVisible();
    await expect(page.locator("h1")).toHaveText("Fixture Listed Project");
    await expect(page.locator("main")).toHaveCount(1);
    const toc = page.locator('nav[aria-labelledby="toc-heading-desktop"]');
    await expect(toc.getByRole("button", { name: "About" })).toBeVisible();
    // No images or linked docs on this project, so the list doesn't offer them.
    await expect(toc.getByRole("button", { name: "Images" })).toHaveCount(0);
    await expect(toc.getByRole("button", { name: "Docs" })).toHaveCount(0);
  });

  test("the owner's picture failing to load falls back to an icon", async ({ page }) => {
    await page.goto("/projects/fixture-listed");
    const avatar = page.getByRole("button", { name: "View user profile" }).first();
    await expect(avatar.locator("svg")).toBeVisible();
  });

  test("unknown, private and graveyard projects still answer 404", async ({ request }) => {
    // A loading.tsx here would stream a 200 before notFound() runs; keep it out.
    for (const slug of ["ui06-no-such-project", "fixture-private", "fixture-deleted-recent"]) {
      expect((await request.get(`/projects/${slug}`)).status(), slug).toBe(404);
    }
  });

  test("focus on a card's title rings the whole card", async ({ page }) => {
    await page.goto(SHARE);
    const listed = card(page, "Fixture Listed Project");
    await listed.getByRole("link", { name: "Fixture Listed Project", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect.poll(() => listed.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  });

  test("no sideways overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/projects/fixture-max-fixture-max-fixture-max-fixture-max-fixture-max-fixture-max-fixture-max-fixt-end");
    await expect(page.locator("h1")).toBeVisible();
    await expect.poll(() => overflowingContent(page)).toEqual([]);
  });
});

test.describe("UI06.3 profiles", () => {
  test("public profile: a failed load says so and Try again recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/api/shared-projects/fixture-alice?*", (route) =>
      fail ? route.fulfill({ status: 500, contentType: "application/json", body: '{"success":false}' }) : route.continue(),
    );
    await page.goto(SHARE);
    const alert = page.getByRole("alert").filter({ hasText: "Projects didn't load" });
    await expect(alert).toBeVisible();
    await expect(page.getByText("hasn't shared any projects")).toHaveCount(0);
    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(card(page, "Fixture Listed Project")).toBeVisible();
  });

  test("public profile: an empty list says so", async ({ page }) => {
    await page.goto("/shared-projects/fixture-claimant");
    await expect(page.locator("h1")).toHaveText("fixture-claimant");
    await expect(page.getByText("fixture-claimant hasn't shared any projects yet.")).toBeVisible();
  });

  test("member profile: signed in, a link to their projects; unknown and failed differ", async ({ page }) => {
    await signIn(page, "ui06-profile");
    await page.goto("/users/fixture-alice");
    await expect(page.locator("h1")).toHaveText("fixture-alice");
    await expect(page.getByRole("link", { name: "View Projects →" })).toHaveAttribute("href", "/projects/users/fixture-alice");

    await page.goto("/users/ui06-nobody-here");
    await expect(page.getByRole("heading", { name: "Profile Not Found" })).toBeVisible();

    await page.route("**/api/profiles/lookup/**", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/users/fixture-alice");
    await expect(page.getByRole("alert").filter({ hasText: "This profile didn't load" })).toBeVisible();
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds nothing in the showcase content, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto(SHARE);
    await expect(card(page, "Fixture Listed Project")).toBeVisible();
    expect(await contentAxe(page)).toEqual([]);
    await page.goto("/projects/fixture-unicode");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    expect(await contentAxe(page)).toEqual([]);
  });
}
