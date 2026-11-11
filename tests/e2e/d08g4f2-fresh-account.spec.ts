// DEF-FLIP-FRESHACCT (D08g4f2, g4f3): a Better Auth account that never had a
// Clerk login (no Clerk-era subject, no persona link), as Jose's own account on
// his fresh dev backend, uses the app end to end with Convex as the data
// default: the dashboard loads, the share link resolves, a project is created,
// opened and edited as its owner, gets an image, shows up in the sidebar
// counts, goes to the graveyard (where its owner still opens it) and is
// purged; a favorite goes on and off, a tag is suggested on someone else's
// project, and the handle changes. Every
// earlier browser test linked a fixture persona first, which is how this gap
// got through.
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { CONVEX_URL } from "../fixtures/convex";
import { placeholderPng } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const headers = { origin: BASE_URL };
const SLUG = "fixture-g4f2-fresh";
const TITLE = "Fixture G4f2 Fresh";
const EDITED = `${TITLE} Edited`;
const FAVORITE = "Fixture Bob's Project";
const OTHER_SLUG = "fixture-bob-project";
const SUGGESTED = `g4f3-fresh-${Date.now().toString(36)}`;

async function signUpFresh(page: Page) {
  const email = syntheticEmail("g4f2-fresh");
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Fresh Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}
const myHandle = async (page: Page) => ((await (await page.request.get("/api/dev/viewer")).json()) as { viewer: { username: string } | null }).viewer?.username;
const projectCard = (page: Page, title: string) => page.locator(".project-card", { hasText: title }).first();
/** The sidebar's personal counts (what /api/categories/counts gives the session), summed. */
const countsTotal = async (page: Page, query: string) => {
  const body = (await (await page.request.get(`/api/categories/counts?${query}`)).json()) as { data: Record<string, number> };
  return Object.values(body.data ?? {}).reduce((a, b) => a + b, 0);
};
const storedImages = (page: Page) => page.locator('img[src*="api%2Fstorage"], img[src*="/api/storage/"]');

test.describe.serial("DEF-FLIP-FRESHACCT: a fresh Better Auth account (Convex default)", () => {

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
    // The image upload goes from the browser to the slot's own Convex backend.
    await context.route(`${CONVEX_URL}/api/storage/upload**`, (route) => route.continue());
  });

  test("dashboard, share link, create, favorite and handle all work without a Clerk-era link", async ({ page, context }) => {
    await signUpFresh(page);
    const handle = await myHandle(page);
    expect(handle).toMatch(/^user-[0-9a-z]{6}$/);

    // The dashboard loads (it said "Unauthorized: User not logged in").
    await page.goto("/dashboard");
    await expect(page.getByText("My Projects").first()).toBeVisible();
    await expect(page.getByText(/Error loading dashboard|Unauthorized/)).toHaveCount(0);

    // Create a project.
    await page.goto("/projects/new");
    await page.locator("#title").fill(TITLE);
    await page.locator("#slug").fill(SLUG);
    await page.locator("#description").fill("Made by the DEF-FLIP-FRESHACCT browser test.");
    await page.getByRole("button", { name: "Create Project" }).click();
    await page.waitForURL(`**/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible();

    // g4f3: /api/projects?slug= finds it for its owner (Convex, not Supabase).
    const bySlug = async () => (await page.request.get(`/api/projects?slug=${SLUG}`)).json() as Promise<{ success: boolean; data?: { title: string } }>;
    expect((await bySlug()).data?.title).toBe(TITLE);

    // g4f3: the sidebar counts it.
    expect(await countsTotal(page, "userId=me")).toBe(1);

    // g4f3: its owner gets the edit form and saves.
    await page.goto(`/projects/${SLUG}?edit=true`);
    await expect(page.locator("#title")).toHaveValue(TITLE);
    await page.locator("#title").fill(EDITED);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: EDITED }).first()).toBeVisible();

    // g4f3: and adds an image.
    await page.goto(`/projects/${SLUG}?edit=true`);
    const images = page.locator("#images");
    await expect(images.getByText("Add a cover image and screenshots")).toBeVisible();
    await images.locator('input[type="file"]').first().setInputFiles({ name: "g4f3-shot.png", mimeType: "image/png", buffer: placeholderPng(64, 40) });
    await expect(images.getByText("All Images")).toBeVisible();
    await page.goto(`/projects/${SLUG}`);
    await expect(storedImages(page).first()).toBeVisible();

    // The share link is the session's own handle.
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await page.goto("/projects/projects-portfolio");
    await expect(projectCard(page, EDITED)).toBeVisible();
    const share = page.getByRole("button", { name: "Copy Share Projects Link" });
    await expect(share).toBeEnabled();
    await share.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${BASE_URL}/shared-projects/${handle}`);

    // The dashboard counts it.
    await page.goto("/dashboard");
    await expect(page.getByText(TITLE).first()).toBeVisible();

    // Favorite someone else's project, then remove it.
    await page.goto("/projects");
    const other = projectCard(page, FAVORITE);
    await expect(other).toBeVisible();
    await other.getByRole("button", { name: "Add to favorites" }).click();
    await expect(other.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
    await expect.poll(() => countsTotal(page, "favorites=true")).toBe(1);
    await page.goto("/projects/favorites");
    await expect(projectCard(page, FAVORITE)).toBeVisible();
    await projectCard(page, FAVORITE).getByRole("button", { name: "Remove from favorites" }).click();
    await page.getByRole("button", { name: "Remove from Favorites" }).click();
    await expect(projectCard(page, FAVORITE)).toHaveCount(0);

    // g4f3: suggest a tag on someone else's project; it stays pending.
    await page.goto(`/projects/${OTHER_SLUG}/suggest-tags`);
    const tagInput = page.locator("#tag-name");
    await tagInput.fill(SUGGESTED);
    await tagInput.blur();
    await page.getByPlaceholder(`Why should #${SUGGESTED} be approved?`).fill("Synthetic reason");
    await page.getByRole("button", { name: /^Submit \(1\)$/ }).click();
    await expect(page.getByText(/tag submissions? received/i).first()).toBeVisible();

    // Change the handle from the dashboard's profile editor.
    const renamed = `${handle}-x`;
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Edit Profile" }).click();
    const username = page.locator("label", { hasText: "Username" }).locator("xpath=following-sibling::input[1]");
    await expect(username).toHaveValue(handle!);
    await username.fill(renamed);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Profile updated successfully")).toBeVisible();
    await expect.poll(() => myHandle(page)).toBe(renamed);

    // Clean up: graveyard and purge the project.
    await page.goto("/projects/projects-portfolio");
    await projectCard(page, EDITED).getByRole("button", { name: "Delete project" }).click();
    await page.getByRole("button", { name: "Send to Graveyard" }).click();
    await expect(page.getByText("Project sent to graveyard").first()).toBeVisible();
    // g4f3: its owner still sees it in the graveyard counts and on its page.
    expect(await countsTotal(page, "deleted=true")).toBe(1);
    await page.goto(`/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: EDITED }).first()).toBeVisible();
    expect((await bySlug()).data?.title).toBe(EDITED);
    await page.goto("/projects/deleted");
    await projectCard(page, EDITED).getByRole("button", { name: "Permanently delete project" }).click();
    await page.getByRole("button", { name: "Permanently Delete" }).click();
    await expect(page.getByText("Project permanently deleted!").first()).toBeVisible();
  });
});
