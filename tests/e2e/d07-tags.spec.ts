// D07-c: with both development switches on (Better Auth and the Convex read),
// a signed-in user suggests two new tags on someone else's project from the
// suggest-tags page; both stay pending (Convex tags:suggest, the submitter from
// the session). An account made admin through users.role (no Clerk-era link)
// opens the server-checked moderation page, sees the suggester's username,
// never an email, approves one tag for the project and rejects the other. The
// suggester's own page can't reach moderation.
import type { Browser, Page } from "@playwright/test";
import { authState, freshClientIp, linkPersona, releasePersona, setRole, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const { b: B } = generateFixtures().personas;

// A's project, not one the visual baselines capture.
const SLUG = "fixture-one-tag";
const APPROVED = `fixture-e2e-yes-${Date.now() % 100000}`;
const REJECTED = `fixture-e2e-no-${Date.now() % 100000}`;

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  const headers = { origin: BASE_URL };
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { [TEST_CLIENT_IP_HEADER]: freshClientIp() } });
  return context.newPage();
}

test.describe.serial("D07 tag suggestions and moderation (Better Auth + Convex read)", () => {

  test.beforeAll(async () => {
    await releasePersona(B.subject!);
  });
  test.afterAll(async () => {
    await releasePersona(B.subject!);
  });

  test("a suggestion stays pending until the users.role admin approves or rejects it", async ({ browser }) => {
    const suggester = await newPage(browser);
    const suggesterEmail = await signIn(suggester, "d07-suggester");
    await linkPersona(B.subject!, (await authState(suggesterEmail))!.authUserId);

    await suggester.goto(`/projects/${SLUG}/suggest-tags`);
    const input = suggester.locator("#tag-name");
    await input.fill(`${APPROVED}, ${REJECTED}`);
    await input.blur();
    for (const name of [APPROVED, REJECTED]) await suggester.getByPlaceholder(`Why should #${name} be approved?`).fill("Synthetic reason");
    await suggester.getByRole("button", { name: /^Submit \(2\)$/ }).click();
    await expect(suggester.getByText(/2 tag submissions received!/)).toBeVisible();
    await suggester.waitForURL(`**/projects/${SLUG}`);
    await expect(suggester.getByText(APPROVED)).toHaveCount(0); // pending, not on the project

    // The suggester isn't an admin: the moderation pages send them to /dashboard.
    await suggester.goto("/dashboard/tag-submissions");
    await suggester.waitForURL("**/dashboard");

    const admin = await newPage(browser);
    await setRole((await authState(await signIn(admin, "d07-admin")))!.authUserId, "admin");
    await admin.goto("/dashboard/tag-submissions");
    const card = (name: string) => admin.locator("div.overflow-hidden", { has: admin.getByText(name, { exact: true }) }).first();
    await expect(card(APPROVED)).toBeVisible();
    for (const name of [APPROVED, REJECTED]) await card(name).getByRole("button", { name: "View All Submissions" }).click();
    await expect(card(APPROVED).getByText("Submitted by: fixture-bob")).toBeVisible();
    expect(await admin.locator("body").textContent()).not.toContain(suggesterEmail);

    await card(APPROVED).getByRole("button", { name: "Approve for Project" }).click();
    await expect(card(APPROVED)).toHaveCount(0);
    await card(REJECTED).getByPlaceholder("Add your feedback here...").fill("Not a fit");
    await card(REJECTED).getByRole("button", { name: "Reject" }).click();
    await expect(card(REJECTED)).toHaveCount(0);

    await suggester.goto(`/projects/${SLUG}`);
    await expect(suggester.getByText(APPROVED).first()).toBeVisible();
    await expect(suggester.getByText(REJECTED)).toHaveCount(0);

    // D07-d: the admin dashboard reads Convex (admin:dashboardStats) and shows no emails.
    await admin.goto("/dashboard/admin");
    await expect(admin).toHaveURL(/\/dashboard\/admin/);
    await expect(admin.getByText("Fixture Listed Project").first()).toBeVisible();
    // The only email on the page is the admin's own, in the account menu.
    expect(await admin.locator("body").textContent()).not.toContain(suggesterEmail);
  });
});
