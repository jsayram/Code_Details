// D08g4e2: the project list follows the Better Auth login: a signed-in user
// gets "Create Project" (it read Clerk's userId before, so it never showed),
// a signed-out visitor doesn't. Synthetic users only; skipped in Clerk mode.
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND !== "clerk";
const headers = { origin: BASE_URL };

test.describe("D08g4e2 project list controls (Better Auth)", () => {
  test.skip(!betterAuth, "needs the Better Auth login (not CODEDETAILS_E2E_AUTH_BACKEND=clerk)");

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("signed in, /projects offers Create Project and it opens the new-project page", async ({ page }) => {
    const email = syntheticEmail("g4e2-create");
    expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await verifyEmail(email);
    expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    await page.goto("/projects");
    const create = page.getByRole("button", { name: "Create Project" });
    await expect(create).toBeVisible();
    await create.click();
    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("signed out, no Create Project", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Create Project" })).toHaveCount(0);
  });
});
