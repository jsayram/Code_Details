// UI08 creator workflows: the dashboard, the project editor, media and the
// profile form. A fresh Better Auth account (no persona link) creates a
// project, edits and saves it, reloads, adds and deletes an image, and the
// project is purged at the end so the shared fixtures stay as they were.
import type { Page, Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { CONVEX_URL } from "../fixtures/convex";
import { placeholderPng } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const headers = { origin: BASE_URL };
const RUN = Date.now().toString(36);
const SLUG = `fixture-ui08-${RUN}`;
const TITLE = `Fixture UI08 ${RUN}`;
const EDITED = `${TITLE} Edited`;

async function signUpFresh(page: Page, label: string) {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Creator Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(WCAG).include("main").analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

const isAction = (route: Route) => route.request().method() === "POST" && !!route.request().headers()["next-action"];
const projectCard = (page: Page, title: string) => page.locator(".project-card", { hasText: title }).first();

async function createProject(page: Page, title: string, slug: string) {
  await page.goto("/projects/new");
  await page.locator("#title").fill(title);
  await page.locator("#slug").fill(slug);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
}

async function purge(page: Page, title: string) {
  await page.goto("/projects/projects-portfolio");
  await projectCard(page, title).getByRole("button", { name: "Delete project" }).click();
  await page.getByRole("button", { name: "Send to Graveyard" }).click();
  await expect(page.getByText("Project sent to graveyard").first()).toBeVisible();
  await page.goto("/projects/deleted");
  await projectCard(page, title).getByRole("button", { name: "Permanently delete project" }).click();
  await page.getByRole("button", { name: "Permanently Delete" }).click();
  await expect(page.getByText("Project permanently deleted!").first()).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  // Uploads go from the browser to the slot's own Convex backend.
  await context.route(`${CONVEX_URL}/api/storage/upload**`, (route) => route.continue());
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe.serial("UI08 creator journey", () => {
  test("create → edit → save → reload → media, with field errors and status", async ({ page }) => {
    test.setTimeout(180_000);
    await signUpFresh(page, "ui08-journey");

    // Create: an empty submit names what's wrong, beside the fields and the button.
    await page.goto("/projects/new");
    await expect(page.locator("main")).toHaveCount(1);
    await page.getByRole("button", { name: "Create Project" }).click();
    const summary = page.getByRole("alert").filter({ hasText: "The project wasn't created" });
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("link", { name: "Title must be at least 3 characters" })).toBeVisible();
    await expect(page.locator("#title")).toBeFocused();
    await expect(page.locator("#title")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#title")).toHaveAccessibleDescription(/Title must be at least 3 characters/);
    await expect(page.locator("#slug")).toHaveAccessibleDescription(/Slug is required/);
    expect(await axe(page)).toEqual([]);
    // Fixing the field clears its error.
    await page.locator("#title").fill(TITLE);
    await expect(page.locator("#title")).not.toHaveAttribute("aria-invalid", "true");
    await page.locator("#slug").fill(SLUG);
    await page.getByRole("button", { name: "Create Project" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}$`));
    await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible();

    // Edit: the status line follows the form.
    await page.goto(`/projects/${SLUG}?edit=true`);
    await expect(page.locator("#title")).toHaveValue(TITLE);
    await expect(page.getByRole("status").filter({ hasText: "No unsaved changes" })).toBeVisible();
    await page.locator("#title").fill(EDITED);
    await expect(page.getByRole("status").filter({ hasText: /^Unsaved changes$/ })).toBeVisible();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Project updated successfully!").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: EDITED }).first()).toBeVisible();

    // Reload: the save is real.
    await page.reload();
    await expect(page.getByRole("heading", { name: EDITED }).first()).toBeVisible();

    // Media: the drop zone is a button, the upload shows as a named thumbnail, delete works.
    await page.goto(`/projects/${SLUG}?edit=true`);
    const images = page.locator("#images");
    await expect(images.getByRole("button", { name: /^Upload Screenshot/ })).toBeVisible();
    await images.locator('input[type="file"]').first().setInputFiles({ name: "ui08-shot.png", mimeType: "image/png", buffer: placeholderPng(64, 40) });
    await expect(images.getByText("All Images")).toBeVisible();
    const preview = images.getByRole("button", { name: "Preview Screenshot 1" });
    await expect(preview).toBeVisible();
    expect(await axe(page)).toEqual([]);
    // The preview opens from the keyboard and gives focus back on close.
    await preview.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    // Save keeps the image; reload shows it on the page.
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Project updated successfully!").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Project Images" })).toBeVisible();
    await page.goto(`/projects/${SLUG}?edit=true`);
    await images.getByRole("button", { name: "Delete Screenshot 1" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(images.getByText("Image deleted").or(page.getByText("Image deleted")).first()).toBeVisible();
    await expect(images.getByRole("button", { name: "Preview Screenshot 1" })).toHaveCount(0);

    await purge(page, EDITED);
  });

  test("unsaved edits: a sidebar link and Cancel ask first, and focus comes back", async ({ page }) => {
    test.setTimeout(150_000);
    await signUpFresh(page, "ui08-guard");
    const title = `${TITLE} Guard`;
    await createProject(page, title, `${SLUG}-guard`);
    await page.goto(`/projects/${SLUG}-guard?edit=true`);
    await expect(page.locator("#title")).toHaveValue(title);
    await page.locator("#title").fill(`${title} changed`);

    // A link elsewhere in the app: the dialog, and the page stays.
    const dashboardLink = page.locator('[data-sidebar="content"]').getByRole("link", { name: "Dashboard", exact: true });
    await dashboardLink.click();
    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("and leave this page");
    expect(await new AxeBuilder({ page }).withTags(WCAG).include('[role="dialog"]').analyze().then((r) => r.violations.map((v) => v.id))).toEqual([]);
    await dialog.getByRole("button", { name: "Continue Editing" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\?edit=true$/);
    await expect(dashboardLink).toBeFocused();
    await expect(page.locator("#title")).toHaveValue(`${title} changed`);

    // Cancel: the dialog, Escape, focus back on Cancel (UI02 #15).
    const cancel = page.getByRole("button", { name: "Cancel" });
    await cancel.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cancel).toBeFocused();

    // The error summary's in-page links don't ask either.
    await page.locator("#title").fill("");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.getByRole("alert").getByRole("link", { name: "Title must be at least 3 characters" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#title")).toBeFocused();
    await page.locator("#title").fill(`${title} changed`);

    // Discard through the link goes where the link pointed.
    await dashboardLink.click();
    await dialog.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await purge(page, title);
  });

  test("create: Cancel after typing asks first; Cancel on an untouched form just leaves", async ({ page }) => {
    await signUpFresh(page, "ui08-create-cancel");
    await page.goto("/projects/new");
    await page.locator("#title").fill("Something typed");
    await page.getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/projects/new");
    await expect(page.locator("#title")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });
});

test.describe("UI08 dashboard", () => {
  test("one main and one h1, named controls, no axe findings in either theme", async ({ page }) => {
    await signUpFresh(page, "ui08-dash");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Personal Analytics Dashboard" })).toBeVisible();
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      for (const name of ["Refresh dashboard data", "Refresh recent appreciation", "Refresh recent activity", "Refresh popular tags", "Refresh my recent projects"]) {
        await expect(page.getByRole("button", { name })).toBeVisible();
      }
      // A link styled as a button, not a button inside a link.
      await expect(page.locator("a button, button a")).toHaveCount(0);
      // The empty account sees the first-project prompt.
      await expect(page.getByRole("heading", { name: "Ready to Share Your Work?" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Create Your First Project/ }).first()).toHaveAttribute("href", "/projects/new");
      expect(await axe(page)).toEqual([]);
    }
  });

  test("loading shows a status; a failed load says so with Try again, without the server's text", async ({ page }) => {
    await signUpFresh(page, "ui08-dash-fail");
    let fail = true;
    await page.route("**/dashboard", (route) => (isAction(route) && fail ? route.fulfill({ status: 500, body: "forced internal detail" }) : route.continue()));
    await page.goto("/dashboard");
    const alert = page.getByRole("alert").filter({ hasText: "Your dashboard didn't load" });
    await expect(alert).toBeVisible();
    await expect(page.getByText("forced internal detail")).toHaveCount(0);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Personal Analytics Dashboard");
    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Ready to Share Your Work?" })).toBeVisible();
    await expect(alert).toHaveCount(0);

    // While the first load is pending, the placeholder says what's happening.
    await page.route("**/dashboard", (route) => (isAction(route) ? new Promise(() => {}) : route.continue()));
    await page.goto("/dashboard");
    await expect(page.getByRole("status").filter({ hasText: "Loading your dashboard" })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("profile form: labels tied, focus moves in and back, a failed save shows in the form", async ({ page }) => {
    await signUpFresh(page, "ui08-profile");
    await page.goto("/dashboard");
    const edit = page.getByRole("button", { name: "Edit Profile" });
    await edit.click();
    const username = page.getByLabel("Username");
    await expect(username).toBeFocused();
    await expect(page.getByLabel("Profile image URL")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Email is managed by your authentication provider");
    expect(await axe(page)).toEqual([]);

    await page.route("**/api/profiles/**", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { detail: "That username is taken" } }) })
        : route.continue(),
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your profile wasn't saved: That username is taken" })).toBeVisible();
    await expect(username).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(edit).toBeFocused();
  });
});
