// D08g3b: with the development switch on, the home page's loading gate, the
// hero's greeting and the terminal's user line follow the Better Auth session.
// Clerk's script is blocked here, as it is in a real browser with the synthetic
// keys, to show the page no longer waits on Clerk.
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";

test.describe("D08g3b identity display (switch on)", () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  test.beforeEach(async ({ context, page }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
    await page.route(/clerk\.browser\.js$/, (route) => route.abort("blockedbyclient"));
  });

  test("signed out, the home page renders without Clerk", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("AUTHENTICATE TO CONTINUE")).toBeVisible();
    await expect(page.getByText("Code Minion!")).toBeVisible();
  });

  test("signed in, the hero greets the Better Auth user and the terminal shows them", async ({ page }) => {
    const email = syntheticEmail("g3b-display");
    const headers = { origin: BASE_URL };
    expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "synthetic person" } })).status()).toBe(200);
    await verifyEmail(email);
    expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    await page.goto("/");
    await expect(page.getByText("You are signed in")).toBeVisible();
    await expect(page.getByText("Synthetic Person!")).toBeVisible();
    await expect(page.getByText("synthetic's_Dashboard")).toBeVisible();
  });
});
