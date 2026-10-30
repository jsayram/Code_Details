// D08f3c: GitHub buttons in the browser, switch on (the handover screen was
// removed in D08g4b).
// The test backend has synthetic GitHub values, so the buttons only get as far
// as GitHub's authorize URL: the network guard records it and aborts it.
// The real GitHub press is manual (Jose).
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";
const SAME_ORIGIN = { origin: BASE_URL };
const AUTHORIZE = "https://github.com/login/oauth/authorize";

test.describe("D08f3c GitHub (switch on)", () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
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

  // D08g4b: the handover is gone; its old path is just the sign-in screen,
  // and its API route no longer exists.
  test("/sign-in/handover shows the plain sign-in screen; POST /api/account/handover is 404", async ({ page }) => {
    await signedIn(page);
    await page.goto("/sign-in/handover");
    await expect(page.getByRole("heading", { name: "Sign in to Code Details" })).toBeVisible();
    await expect(page.getByText("Set up your new login")).toHaveCount(0);
    const res = await page.request.post("/api/account/handover", { headers: SAME_ORIGIN, data: {}, maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});
