// D02-c: with both development switches on (Better Auth and the Convex read),
// the owner edits a project on its page and the save goes to projects:update.
// A Better Auth login linked to persona A owns A's projects; an unlinked login
// sees the page without edit controls. The edit is undone at the end, so the
// shared fixture stays as it was for the other specs.
import type { Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const { a: A } = generateFixtures().personas;

// Not one of the visually compared projects (visual*.spec.ts): the edit changes its updated date.
const SLUG = "fixture-one-tag";
const TITLE = "Fixture One Tag";
const NEW_SLUG = "fixture-one-tag-edited";
const NEW_TITLE = "Fixture One Tag Edited";

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

async function saveEdit(page: Page, title: string, slug: string) {
  await page.locator("#title").fill(title);
  await page.locator("#slug").fill(slug);
  await page.getByRole("button", { name: "Save Changes" }).click();
}

test.describe.serial("D02 project update (Better Auth + Convex read)", () => {

  test.beforeAll(async () => {
    await releasePersona(A.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(A.subject!);
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("the owner edits title and slug; the old slug redirects; a save from an older tab is refused", async ({ page, context }) => {
    await linkPersona(A.subject!, (await authState(await signIn(page, "d02-owner")))!.authUserId);

    await page.goto(`/projects/${SLUG}?edit=true`);
    await expect(page.locator("#title")).toHaveValue(TITLE);
    // A second tab opened on the same version, saved after the first one.
    const older = await context.newPage();
    await older.goto(`/projects/${SLUG}?edit=true`);
    await expect(older.locator("#title")).toHaveValue(TITLE);

    await saveEdit(page, NEW_TITLE, NEW_SLUG);
    await page.waitForURL(`**/projects/${NEW_SLUG}`);
    await expect(page.getByRole("heading", { name: NEW_TITLE }).first()).toBeVisible();

    await page.goto(`/projects/${SLUG}`);
    await page.waitForURL(`**/projects/${NEW_SLUG}`);

    await older.locator("#title").fill("From an older tab");
    await older.getByRole("button", { name: "Save Changes" }).click();
    await expect(older.getByText(/changed somewhere else since you opened it/).first()).toBeVisible();
    await older.close();

    // Undo, which also takes the old slug back.
    await page.goto(`/projects/${NEW_SLUG}?edit=true`);
    await expect(page.locator("#title")).toHaveValue(NEW_TITLE);
    await saveEdit(page, TITLE, SLUG);
    await page.waitForURL(`**/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible();
  });

  test("an unlinked login sees A's project with no edit controls, even with ?edit=true", async ({ page }) => {
    await signIn(page, "d02-other");
    await page.goto("/projects/fixture-listed?edit=true");
    await expect(page.getByRole("heading", { name: "Fixture Listed Project" }).first()).toBeVisible();
    await expect(page.locator("#title")).toHaveCount(0);
    await expect(page.getByText("Edit Project")).toHaveCount(0);
  });
});
