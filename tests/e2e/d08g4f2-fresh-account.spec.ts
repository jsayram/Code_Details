// DEF-FLIP-FRESHACCT (D08g4f2): a Better Auth account that never had a Clerk
// login (no Clerk-era subject, no persona link), as Jose's own account on his
// fresh dev backend, uses the app end to end with Convex as the data default:
// the dashboard loads, the share link resolves, a project is created (and
// purged again), a favorite goes on and off, and the handle changes. Every
// earlier browser test linked a fixture persona first, which is how this gap
// got through.
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const headers = { origin: BASE_URL };
const SLUG = "fixture-g4f2-fresh";
const TITLE = "Fixture G4f2 Fresh";
const FAVORITE = "Fixture Bob's Project";

async function signUpFresh(page: Page) {
  const email = syntheticEmail("g4f2-fresh");
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Fresh Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}
const myHandle = async (page: Page) => ((await (await page.request.get("/api/dev/viewer")).json()) as { viewer: { username: string } | null }).viewer?.username;
const projectCard = (page: Page, title: string) => page.locator(".project-card", { hasText: title }).first();

test.describe.serial("DEF-FLIP-FRESHACCT: a fresh Better Auth account (Convex default)", () => {
  test.skip(!convexRead, "needs CODEDETAILS_E2E_READ_BACKEND=convex (the data default)");

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
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

    // The share link is the session's own handle.
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await page.goto("/projects/projects-portfolio");
    await expect(projectCard(page, TITLE)).toBeVisible();
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
    await page.goto("/projects/favorites");
    await expect(projectCard(page, FAVORITE)).toBeVisible();
    await projectCard(page, FAVORITE).getByRole("button", { name: "Remove from favorites" }).click();
    await page.getByRole("button", { name: "Remove from Favorites" }).click();
    await expect(projectCard(page, FAVORITE)).toHaveCount(0);

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
    await projectCard(page, TITLE).getByRole("button", { name: "Delete project" }).click();
    await page.getByRole("button", { name: "Send to Graveyard" }).click();
    await expect(page.getByText("Project sent to graveyard").first()).toBeVisible();
    await page.goto("/projects/deleted");
    await projectCard(page, TITLE).getByRole("button", { name: "Permanently delete project" }).click();
    await page.getByRole("button", { name: "Permanently Delete" }).click();
    await expect(page.getByText("Project permanently deleted!").first()).toBeVisible();
  });
});
