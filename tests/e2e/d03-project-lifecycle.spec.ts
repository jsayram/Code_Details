// D03-c: with both development switches on (Better Auth and the Convex read),
// the owner creates a project, sends it to the graveyard, restores it, sends it
// back and purges it, all through the real pages; every save goes to the
// projectLifecycle mutations, which take the user from the session. The
// project is purged at the end, so the shared fixture set is as it was.
import type { Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const convexRead = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex";
const { a: A } = generateFixtures().personas;

const SLUG = "fixture-d03-lifecycle";
const TITLE = "Fixture D03 Lifecycle";

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

const card = (page: Page) => page.locator(".project-card", { hasText: TITLE });

async function sendToGraveyard(page: Page) {
  await page.goto("/projects/projects-portfolio");
  await card(page).getByRole("button", { name: "Delete project" }).click();
  await page.getByRole("button", { name: "Send to Graveyard" }).click();
  await expect(page.getByText("Project sent to graveyard").first()).toBeVisible();
  await expect(card(page)).toHaveCount(0);
}

test.describe.serial("D03 project lifecycle (Better Auth + Convex read)", () => {
  test.skip(!convexRead, "needs CODEDETAILS_E2E_READ_BACKEND=convex");

  test.beforeAll(async () => {
    await releasePersona(A.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(A.subject!);
  });
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("the owner creates, deletes, restores and purges a project", async ({ page, browser }) => {
    await linkPersona(A.subject!, (await authState(await signIn(page, "d03-owner")))!.authUserId);

    // Create.
    await page.goto("/projects/new");
    await page.locator("#title").fill(TITLE);
    await page.locator("#slug").fill(SLUG);
    await page.locator("#description").fill("Made by the D03 browser test.");
    await page.getByRole("button", { name: "Create Project" }).click();
    await page.waitForURL(`**/projects/${SLUG}`);
    await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible();

    // Soft delete: gone from the owner's list and from the public page.
    await sendToGraveyard(page);
    const visitor = await browser.newContext();
    const anon = await visitor.newPage();
    await anon.goto(`/projects/${SLUG}`);
    await expect(anon.getByRole("heading", { name: TITLE })).toHaveCount(0);

    // Restore from the graveyard: public again.
    await page.goto("/projects/deleted");
    await card(page).getByRole("button", { name: "Restore project" }).click();
    await page.getByRole("button", { name: "Restore Project" }).click();
    await expect(page.getByText("Project restored successfully").first()).toBeVisible();
    await anon.goto(`/projects/${SLUG}`);
    await expect(anon.getByRole("heading", { name: TITLE }).first()).toBeVisible();

    // Delete again and purge.
    await sendToGraveyard(page);
    await page.goto("/projects/deleted");
    await card(page).getByRole("button", { name: "Permanently delete project" }).click();
    await page.getByRole("button", { name: "Permanently Delete" }).click();
    await expect(page.getByText("Project permanently deleted!").first()).toBeVisible();
    await page.reload();
    await expect(card(page)).toHaveCount(0);
    await visitor.close();
  });

  test("an unlinked login sees no delete controls on the community list", async ({ page }) => {
    await signIn(page, "d03-other");
    await page.goto("/projects");
    await expect(page.locator(".project-card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete project" })).toHaveCount(0);
  });
});
