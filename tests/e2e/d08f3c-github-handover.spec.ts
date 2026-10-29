// D08f3c: GitHub buttons and the handover screen in the browser, switch on.
// The test backend has synthetic GitHub values, so the buttons only get as far
// as GitHub's authorize URL: the network guard records it and aborts it.
// The real GitHub press and the real-Clerk handover are manual (Jose).
import { SYNTHETIC_PASSWORD, freshClientIp, syntheticEmail, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
const SAME_ORIGIN = { origin: BASE_URL };
const AUTHORIZE = "https://github.com/login/oauth/authorize";

test.describe("D08f3c GitHub and handover (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": freshClientIp() });
  });

  async function signedIn(page: import("@playwright/test").Page) {
    const email = syntheticEmail("f3c");
    expect((await page.request.post("/api/auth/sign-up/email", { headers: SAME_ORIGIN, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await verifyEmail(email);
    expect((await page.request.post("/api/auth/sign-in/email", { headers: SAME_ORIGIN, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    return email;
  }

  for (const path of ["/sign-in", "/sign-up"]) {
    test(`"Continue with GitHub" on ${path} goes to GitHub's authorize page`, async ({ page, blocked }) => {
      await page.goto(path);
      await page.getByRole("button", { name: "Continue with GitHub" }).click();
      await expect.poll(() => blocked.some((b) => b.url === AUTHORIZE && b.resourceType === "document")).toBe(true);
    });
  }

  test("the account menu offers Connect GitHub and starts linking the same way", async ({ page, blocked }) => {
    await signedIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Open account menu" }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "Connect GitHub" }).click();
    await expect.poll(() => blocked.some((b) => b.url === AUTHORIZE && b.resourceType === "document")).toBe(true);
  });

  test("the handover screen with a new login but no old (Clerk) login shows step 1 undone and no link button", async ({ page }) => {
    const email = await signedIn(page);
    await page.goto("/sign-in/handover");
    await expect(page.getByRole("heading", { name: "Set up your new login" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with the old login" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link my account" })).toHaveCount(0);
    // The route itself refuses without a Clerk session (D08d): Clerk's protect() redirects it.
    const res = await page.request.post("/api/account/handover", { headers: SAME_ORIGIN, data: {}, maxRedirects: 0 });
    expect(res.ok()).toBe(false);
  });

  test("signed out, the handover screen points to creating the new login and comes back", async ({ page }) => {
    await page.goto("/sign-in/handover");
    await page.getByRole("link", { name: "Create it" }).click();
    await expect(page).toHaveURL(/\/sign-up\?redirect_url=%2Fsign-in%2Fhandover$/);
  });
});
