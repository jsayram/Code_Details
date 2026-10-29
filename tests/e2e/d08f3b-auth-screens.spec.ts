// D08f3b: the app's own auth screens, driven in the browser with the
// development switch on. Mail goes to the fake Mailpit; users are synthetic.
// With the switch off these are skipped and Clerk's screens are untouched
// (the visual specs keep their baselines).
//
// CODEDETAILS_E2E_SCREENS_DIR=<dir> also saves a screenshot of each screen
// there, for Jose to compare with the Phase A a08 references.
// CODEDETAILS_E2E_SCREENS_VARIANT picks desktop|mobile and dark|light
// (default desktop-dark); files are d08f3b-<screen>-<variant>.png.
import path from "node:path";
import type { Page } from "@playwright/test";
import { SYNTHETIC_PASSWORD, freshClientIp, syntheticEmail } from "../fixtures/better-auth";
import { fakeMailpit, linkIn } from "../fixtures/fake-mailpit";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
const SCREENS = process.env.CODEDETAILS_E2E_SCREENS_DIR;
const VARIANT = process.env.CODEDETAILS_E2E_SCREENS_VARIANT ?? "desktop-dark";
const SCHEME = VARIANT.endsWith("light") ? "light" : "dark";
const MOBILE = VARIANT.startsWith("mobile");
const SAME_ORIGIN = { origin: BASE_URL };

/** The emailed link, followed on the app under test (the test backend's SITE_URL is the dev origin). */
const onApp = (mail: Parameters<typeof linkIn>[0]) => {
  const link = linkIn(mail);
  return `${link.pathname}${link.search}`;
};

async function shot(page: Page, name: string) {
  if (!SCREENS) return;
  await page.emulateMedia({ colorScheme: SCHEME, reducedMotion: "reduce" });
  await page.waitForTimeout(700); // the title's fade-in
  await page.screenshot({ path: path.join(SCREENS, `d08f3b-${name}-${VARIANT}.png`), fullPage: MOBILE });
}

test.describe("D08f3b auth screens (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");
  const mailbox = fakeMailpit();

  test.beforeAll(async () => {
    await mailbox.start();
  });
  test.afterAll(async () => {
    await mailbox.stop();
  });
  test.beforeEach(async ({ context, page }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": freshClientIp() });
    if (SCREENS) {
      await page.emulateMedia({ colorScheme: SCHEME });
      await context.addInitScript((theme) => localStorage.setItem("theme", theme), SCHEME);
      if (MOBILE) await page.setViewportSize({ width: 375, height: 812 });
    }
  });

  test("sign up, confirm from the email, sign in, and the header shows the account", async ({ page }) => {
    const email = syntheticEmail("f3b-signup");
    await page.goto("/sign-up");
    await shot(page, "sign-up");
    await page.getByLabel("Name").fill("Synthetic Person");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await shot(page, "check-inbox");

    const [mail] = await mailbox.waitFor(email, "verify-email");
    await page.goto(onApp(mail));
    await expect(page).toHaveURL(/\/sign-in\?verified=1$/);
    await expect(page.locator("main").getByRole("status")).toHaveText("Email confirmed. Sign in to continue.");
    await shot(page, "sign-in");

    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Open account menu" }).filter({ visible: true })).toHaveCount(1);

    // The same link a second time: used up, so the f6 screen.
    await page.goto(onApp(mail));
    await expect(page).toHaveURL(/\/sign-in\/error\?error=invalid_link$/);
    await expect(page.getByRole("heading", { name: "This link has expired or was already used" })).toBeVisible();
    await expect(page.getByText(/Some mail apps open links ahead of you/)).toBeVisible();
    await shot(page, "link-used");
  });

  test("a wrong password says so and doesn't sign in", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(syntheticEmail("f3b-nobody"));
    await page.getByLabel("Password").fill("not-the-Password-1");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("an unconfirmed address is told to confirm first and can get a new link", async ({ page }) => {
    const email = syntheticEmail("f3b-unconfirmed");
    expect((await page.request.post("/api/auth/sign-up/email", { headers: SAME_ORIGIN, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await mailbox.waitFor(email, "verify-email");
    await page.goto("/sign-in");
    await page.getByLabel("Email address").first().fill(email);
    await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("Confirm your email first");
    // Better Auth also mails a link on the refused sign-in; count from here.
    await expect.poll(() => mailbox.mailFor(email, "verify-email").length).toBeGreaterThanOrEqual(2);
    const before = mailbox.mailFor(email, "verify-email").length;
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByText(/If that email needs a link, we've sent a new one/)).toBeVisible();
    expect((await mailbox.waitFor(email, "verify-email", before + 1)).length).toBe(before + 1);
  });

  test("reset the password from the emailed link, then sign in with the new one", async ({ page }) => {
    const email = syntheticEmail("f3b-reset");
    expect((await page.request.post("/api/auth/sign-up/email", { headers: SAME_ORIGIN, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    const [verify] = await mailbox.waitFor(email, "verify-email");
    await page.goto(onApp(verify));

    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/sign-in\/reset-password$/);
    await shot(page, "reset-request");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByText(/If that email needs a link, we've sent a new one/)).toBeVisible();

    const [reset] = await mailbox.waitFor(email, "reset-password");
    // Better Auth answers the reset link with an absolute redirect on its SITE_URL
    // (the dev origin on the test backend); follow it on the app under test.
    const toForm = await page.request.get(onApp(reset), { maxRedirects: 0 });
    expect(toForm.status()).toBe(302);
    const form = new URL(toForm.headers().location);
    await page.goto(`${form.pathname}${form.search}`);
    await expect(page).toHaveURL(/\/sign-in\/reset-password\?token=/);
    await shot(page, "reset-new-password");
    await page.getByLabel("New password", { exact: true }).fill("synthetic-New-Password-456");
    await page.getByLabel("Confirm new password").fill("synthetic-New-Password-456");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("synthetic-New-Password-456");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open account menu" }).filter({ visible: true })).toHaveCount(1);

    // The reset link again: Better Auth refuses it, and the f6 screen offers a new reset link.
    const again = await page.request.get(onApp(reset), { maxRedirects: 0 });
    const refused = new URL(again.headers().location);
    expect(refused.searchParams.get("error")).toBe("INVALID_TOKEN");
    await page.goto(`${refused.pathname}${refused.search}`);
    await expect(page.getByRole("heading", { name: "This link has expired or was already used" })).toBeVisible();
  });

  test("Better Auth's error redirect lands on the app's screen: account_not_linked uses the f3 wording", async ({ page }) => {
    await page.goto("/api/auth/error?error=account_not_linked&error_description=synthetic%20detail");
    await expect(page).toHaveURL(/\/sign-in\/error\?error=account_not_linked/);
    await expect(page.getByText("This email is already used by a Code Details account. Sign in with your password, then connect GitHub from your settings.")).toBeVisible();
    await expect(page.getByText("synthetic detail")).toHaveCount(0);
    await shot(page, "error-account-not-linked");
  });

  test("the header's Sign In goes to the app's sign-in screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign In" }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Sign in to Code Details" })).toBeVisible();
  });
});
