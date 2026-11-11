// D08f3a: with the development switch on, the header follows the Better Auth
// session: the app's account menu when signed in, "Sign In" after signing out
// from it, and the server gates on the project page agree. Synthetic users
// only. With the switch off (the normal runs) these are skipped, and the
// visual specs keep the Clerk header pixel-identical.
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const listed = generateFixtures().projects.find((p) => p.case === "listed")!;

test.describe("D08f3a account menu (switch on)", () => {

  test.beforeEach(async ({ context, page }) => {
    // Its own client IP, as a proxy would set it, so Better Auth's per-IP limits don't collide.
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
    const email = syntheticEmail("f3a-menu");
    const headers = { origin: BASE_URL };
    const up = await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } });
    expect(up.status()).toBe(200);
    await verifyEmail(email);
    const signIn = await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } });
    expect(signIn.status()).toBe(200);
  });

  test("the home header shows the account menu, and signing out from it shows Sign In", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open account menu" }).filter({ visible: true });
    await expect(trigger).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Sign In" }).filter({ visible: true })).toHaveCount(0);
    await trigger.click();
    await expect(page.getByRole("menu")).toContainText("Synthetic Person");
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign In" }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open account menu" })).toHaveCount(0);
    const viewer = await page.request.get("/api/dev/viewer");
    expect(await viewer.json()).toEqual({ viewer: null });
  });

  test("the project page's server gates see the session", async ({ page }) => {
    await page.goto(`/projects/${listed.slug}`);
    await expect(page.getByRole("button", { name: "Open account menu" }).filter({ visible: true })).toHaveCount(1);
    // The signed-out banner is rendered by the server gate; it isn't in the HTML.
    await expect(page.getByText("Sign in to explore more of their projects")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
  });
});
