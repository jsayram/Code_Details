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

  test("guard after review: new-tab clicks pass, Discard toward the same page re-arms, a save is the new baseline", async ({ page, context }) => {
    test.setTimeout(150_000);
    await signUpFresh(page, "ui08-guard-2");
    const title = `${TITLE} Rearm`;
    const slug = `${SLUG}-rearm`;
    await createProject(page, title, slug);
    await page.goto(`/projects/${slug}?edit=true`);
    await expect(page.locator("#title")).toHaveValue(title);
    await page.locator("#title").fill(`${title} changed`);
    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });
    const dashboardLink = page.locator('[data-sidebar="content"]').getByRole("link", { name: "Dashboard", exact: true });

    // Cmd/Ctrl-click opens a new tab and leaves this one, and its edits, alone.
    const opened = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
    await dashboardLink.click({ modifiers: ["ControlOrMeta"] });
    await (await opened)?.close();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\?edit=true$/);
    await expect(page.locator("#title")).toHaveValue(`${title} changed`);

    // Discard toward this same project (view mode): the editor stays mounted.
    await page.evaluate((href) => {
      const a = document.createElement("a");
      a.href = href;
      a.id = "ui08-same-project";
      a.textContent = "This project";
      a.style.cssText = "position:fixed;top:8px;left:50%;z-index:2147483647;background:#fff;color:#000;padding:8px";
      document.body.append(a);
    }, `/projects/${slug}`);
    await page.locator("#ui08-same-project").click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
    // Editing again: the guard is back.
    await page.getByRole("button", { name: /Edit/ }).first().click();
    await expect(page.locator("#title")).toHaveValue(title);
    await page.locator("#title").fill(`${title} again`);
    await dashboardLink.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue Editing" }).click();

    // A save with the same slug never reads as unsaved afterwards.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __ui08Status: string[] }).__ui08Status = seen;
      new MutationObserver(() => {
        for (const el of Array.from(document.querySelectorAll('[role="status"]'))) seen.push((el.textContent ?? "").trim());
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Project updated successfully!").first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
    await expect(page.getByRole("heading", { name: `${title} again` }).first()).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __ui08Status: string[] }).__ui08Status);
    const saving = seen.findIndex((t) => t.includes("Saving your changes"));
    expect(saving).toBeGreaterThanOrEqual(0);
    expect(seen.slice(saving).filter((t) => t === "Unsaved changes")).toEqual([]);

    await purge(page, `${title} again`);
  });

  test("an image uploaded and deleted in one session isn't deleted again on Cancel", async ({ page }) => {
    test.setTimeout(150_000);
    await signUpFresh(page, "ui08-pending");
    const title = `${TITLE} Pending`;
    const slug = `${SLUG}-pending`;
    await createProject(page, title, slug);
    await page.goto(`/projects/${slug}?edit=true`);
    const images = page.locator("#images");
    await images.locator('input[type="file"]').first().setInputFiles({ name: "ui08-pending.png", mimeType: "image/png", buffer: placeholderPng(64, 40) });
    await expect(images.getByRole("button", { name: "Preview Screenshot 1" })).toBeVisible();

    // Every server-action body, so the delete call can be counted by its argument.
    const bodies: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) bodies.push(r.postData() ?? "");
    });
    await images.getByRole("button", { name: "Delete Screenshot 1" }).click();
    const before = bodies.length;
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(images.getByRole("button", { name: "Preview Screenshot 1" })).toHaveCount(0);
    const deleteBody = bodies.slice(before).find((b) => /^\["[^"]+"\]$/.test(b));
    expect(deleteBody).toBeTruthy();

    // Nothing is pending any more: Cancel leaves without asking and without a second delete.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.locator("main").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Unsaved Changes" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
    await page.waitForTimeout(1500);
    expect(bodies.filter((b) => b === deleteBody)).toHaveLength(1);

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

  test("a failed refresh keeps the dashboard and says it couldn't refresh", async ({ page }) => {
    await signUpFresh(page, "ui08-dash-stale");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Ready to Share Your Work?" })).toBeVisible();
    await page.route("**/dashboard", (route) => (isAction(route) ? route.fulfill({ status: 500, body: "forced internal detail" }) : route.continue()));
    await page.getByRole("button", { name: "Refresh dashboard data" }).click();
    const note = page.getByRole("alert").filter({ hasText: "Couldn't refresh your dashboard" });
    await expect(note).toBeVisible();
    await expect(note).toContainText("What you see is from the last successful load.");
    // The older data is still on screen, and the server's text isn't.
    await expect(page.getByRole("heading", { name: "Ready to Share Your Work?" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Personal Analytics Dashboard" })).toBeVisible();
    await expect(page.getByText("forced internal detail")).toHaveCount(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await note.getByRole("button", { name: "Try again" }).click();
    await expect(note).toHaveCount(0);
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
    // A server failure isn't the username's fault.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("**/api/profiles/**", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { detail: "Something broke" } }) })
        : route.continue(),
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your profile wasn't saved: Something broke" })).toBeVisible();
    await expect(username).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(edit).toBeFocused();
  });
});
