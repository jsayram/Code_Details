// UI09 account and secondary screens: the auth journeys (sign in with a
// return path, a wrong password, a reset request, sign out), the admin gate for
// a regular account, not-found signed in and out, and the secondary pages on
// the foundations. Fresh synthetic accounts only; nothing a persona owns is used.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { authState, freshClientIp, setRole, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const headers = { origin: BASE_URL };

async function account(page: Page, label: string, signIn = true): Promise<string> {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  if (signIn) expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

async function axe(page: Page) {
  // Framer Motion's entrance fades (kept under reduced motion) must finish
  // first, or axe measures half-transparent text.
  await expect
    .poll(() => page.evaluate(() => Array.from(document.querySelectorAll("main h1, main p")).every((el) => { for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).opacity !== "1") return false; return true; })))
    .toBe(true);
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

async function oneMainOneH1(page: Page, h1: string | RegExp) {
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
}

const accountButton = (page: Page) => page.getByRole("button", { name: "Open account menu" }).filter({ visible: true });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.describe("UI09.1 auth screens", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: each auth screen has one main, one h1 and no axe findings`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const screens: [string, string][] = [
        ["/sign-in", "Sign in to Code Details"],
        ["/sign-in?verified=1", "Sign in to Code Details"],
        ["/sign-up", "Create your account"],
        ["/sign-in/reset-password", "Reset your password"],
        ["/sign-in/error?error=invalid_link", "This link has expired or was already used"],
        ["/sign-in/error?error=account_not_linked", "Sign in with your password"],
      ];
      for (const [url, h1] of screens) {
        await page.goto(url);
        await oneMainOneH1(page, h1);
        await expect(page.getByRole("button", { name: "Continue", exact: true }).or(page.getByRole("button", { name: "Send a new link" })).or(page.getByRole("link", { name: /Sign in with your password|Try again/ })).first()).toBeEnabled();
        expect(await axe(page), url).toEqual([]);
      }
    });
  }

  test("sign in returns to the page in redirect_url, and only to this site", async ({ page }) => {
    const email = await account(page, "ui09-return", false);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Fdashboard$/);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(accountButton(page)).toHaveCount(1);

    // Another site, a protocol-relative URL and a script URL all land on home.
    for (const target of ["https://evil.example/steal", "//evil.example/steal", "/\\evil.example", "javascript:alert(1)"]) {
      await page.context().clearCookies();
      await page.goto(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page, target).toHaveURL(`${BASE_URL}/`);
    }
  });

  test("a wrong password is named on the fields, keeps focus in the form, and doesn't sign in", async ({ page }) => {
    const email = await account(page, "ui09-wrong", false);
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("not-the-Password-1");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toHaveText("Email or password is incorrect.");
    const password = page.getByLabel("Password");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAccessibleDescription("Email or password is incorrect.");
    // Both fields are named by the message; focus goes to the first.
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email address")).toBeFocused();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(accountButton(page)).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    // Typing again clears the invalid mark; the right password signs in.
    await password.fill(SYNTHETIC_PASSWORD);
    await expect(password).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });

  test("reset request: Forgot password? opens the form, and the answer is the same for any address", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/sign-in\/reset-password$/);
    await oneMainOneH1(page, "Reset your password");
    await page.getByLabel("Email address").fill(syntheticEmail("ui09-reset-nobody"));
    await page.getByRole("button", { name: "Send a new link" }).click();
    const status = page.locator("main").getByRole("status");
    await expect(status).toHaveText(/If that email needs a link, we've sent a new one/);
    expect(await axe(page)).toEqual([]);
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("a new-password mismatch marks the confirm field", async ({ page }) => {
    await page.goto("/sign-in/reset-password?token=ui09-placeholder");
    await oneMainOneH1(page, "Choose a new password");
    await page.getByLabel("New password", { exact: true }).fill("synthetic-New-Password-456");
    await page.getByLabel("Confirm new password").fill("synthetic-Other-Password-789");
    await page.getByRole("button", { name: "Change password" }).click();
    const confirm = page.getByLabel("Confirm new password");
    await expect(confirm).toHaveAttribute("aria-invalid", "true");
    await expect(confirm).toHaveAccessibleDescription("The passwords don't match.");
    await expect(confirm).toBeFocused();
  });

  test("sign out from the account menu, then a protected page asks to sign in again", async ({ page }) => {
    await account(page, "ui09-signout-menu");
    await page.goto("/projects/favorites");
    await accountButton(page).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(accountButton(page)).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Fdashboard$/);
  });

  test("sign out from /auth/sign-out", async ({ page }) => {
    await account(page, "ui09-signout-page");
    await page.goto("/auth/sign-out");
    await oneMainOneH1(page, "Sign out of your account");
    expect(await axe(page)).toEqual([]);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(accountButton(page)).toHaveCount(0);
  });
});

test.describe("UI09.3 admin gate and secondary routes", () => {
  test("a regular account is sent from every admin route to the dashboard", async ({ page }) => {
    await account(page, "ui09-regular");
    for (const path of ["/dashboard/admin", "/dashboard/tag-submissions", "/llm-test", "/scrapper-demo", "/api/toasttest"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard$/);
    }
  });

  test("an admin sees the admin dashboard and tag submissions on the foundations", async ({ page }) => {
    test.setTimeout(180_000);
    const email = await account(page, "ui09-admin");
    await setRole((await authState(email))!.authUserId, "admin");
    await page.goto("/dashboard/admin");
    await oneMainOneH1(page, "Admin Dashboard");
    await expect(page.getByRole("button", { name: /^Refresh/ }).first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.goto("/dashboard/tag-submissions");
    await oneMainOneH1(page, "Tag Submissions");
    expect(await axe(page)).toEqual([]);
  });

  test("not-found: signed in, inside the shell, with a way home", async ({ page }) => {
    await account(page, "ui09-404");
    const res = await page.goto("/ui09-no-such-page");
    expect(res?.status()).toBe(404);
    await oneMainOneH1(page, "Page not found");
    await expect(page.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    // The mascot is a button now: it changes what it says.
    const mascot = page.getByRole("button", { name: /Show another message/ });
    const before = await page.getByTestId("not-found-message").textContent();
    await mascot.click();
    await expect(page.getByTestId("not-found-message")).not.toHaveText(before ?? "");
    expect(await axe(page)).toEqual([]);
  });

  test("not-found: signed out, an unknown project is a 404 that offers sign in", async ({ page }) => {
    const res = await page.goto("/projects/ui09-no-such-project");
    expect(res?.status()).toBe(404);
    await oneMainOneH1(page, "Page not found");
    await page.locator(".cd-not-found-actions").getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Fprojects%2Fui09-no-such-project$/);
  });

  test("/users: the people cards are reached by Tab and open with Enter", async ({ page }) => {
    await account(page, "ui09-users");
    await page.goto("/users");
    await oneMainOneH1(page, "Browse by Users");
    const card = page.locator('main [data-slot="card"][role="link"]').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("tabindex", "0");
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/users\/[^/]+$/);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: About, Community and Support are in the shell with one h1 and no axe findings`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await account(page, `ui09-secondary-${scheme}`);
      for (const [path, h1] of [["/about", "Developer, Creator, and Innovator"], ["/community", "Code Details Community"], ["/support", "Help & Support"]] as const) {
        await page.goto(path);
        await oneMainOneH1(page, h1);
        await expect(page.locator('[data-slot="sidebar"]').first()).toBeAttached();
        expect(await axe(page), path).toEqual([]);
      }
      await page.goto("/about");
      for (const name of ["GitHub", "LinkedIn", "Email"]) await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    });
  }
});
