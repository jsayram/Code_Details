// f7 (D08g3a): text typed into the auth forms while the page's JavaScript is
// still loading survives hydration. The app's script chunks are held back
// until the fields are filled, so the typing really happens before hydration.
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";

test.describe("f7 auth forms before hydration (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test("sign-up fields typed before hydration are still there after it, and the form then works", async ({ context, page }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
    // Warm the dev server's compile so the held-back run below measures hydration, not compilation.
    await page.goto("/sign-up");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Scripts only: in development the stylesheets are chunks too, and holding them would block rendering.
    await page.route(/\/_next\/static\/chunks\/.*\.js(\?|$)/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/sign-up", { waitUntil: "commit" });
    const email = syntheticEmail("g3a-early");
    const continueButton = page.getByRole("button", { name: "Continue", exact: true });
    await expect(page.getByLabel("Name")).toBeVisible();
    // Not hydrated yet: the submit button is still disabled.
    await expect(continueButton).toBeDisabled();
    await page.getByLabel("Name").pressSequentially("Early Person");
    await page.getByLabel("Email address").pressSequentially(email);
    await page.getByLabel("Password").pressSequentially(SYNTHETIC_PASSWORD);
    await expect(continueButton).toBeDisabled();

    release();
    await expect(continueButton).toBeEnabled();
    await expect(page.getByLabel("Name")).toHaveValue("Early Person");
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    await expect(page.getByLabel("Password")).toHaveValue(SYNTHETIC_PASSWORD);
    await continueButton.click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });
});
