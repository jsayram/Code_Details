// D08g3b: with the development switch on, the home page's loading gate, the
// hero's greeting and the terminal's user line follow the Better Auth session.
// Clerk's script is blocked here, as it is in a real browser with the synthetic
// keys, to show the page no longer waits on Clerk.
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";


test.describe("D08g3b identity display (switch on)", () => {

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("signed out, the home page renders", async ({ page }) => {
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
