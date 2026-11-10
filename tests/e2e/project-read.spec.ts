// Phase C: the public project page for signed-out visitors, served by the
// Convex read (the only one since E03). Not-found must not reveal whether a
// project exists: deleted and missing slugs give the same status and the same page.
import { convexImportUsername, generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const set = generateFixtures();

// Dev-mode HTML carries a per-request ID and dev-only debug-info rows whose
// numbering varies run to run; both are stripped before comparing.
async function notFoundPage(request: import("@playwright/test").APIRequestContext, slug: string) {
  const res = await request.get(`/projects/${slug}`);
  const body = (await res.text())
    .split(slug).join("<slug>")
    .replace(/self\.__next_r="[^"]*"/g, "")
    .replace(/[0-9a-f]+:D\\"\$[0-9a-f]+\\"\\n/g, "");
  return { status: res.status(), body };
}

test.describe("public project read, signed out", () => {
  test("deleted and missing projects answer the same 404 page", async ({ request }) => {
    const missing = await notFoundPage(request, "fixture-does-not-exist");
    expect(missing.status).toBe(404);
    for (const c of ["deletedRecent", "deletedLongAgo"]) {
      const p = set.projects.find((x) => x.case === c)!;
      const deleted = await notFoundPage(request, p.slug);
      expect(deleted.status, c).toBe(404);
      expect(deleted.body, c).toBe(missing.body);
      expect(deleted.body, c).not.toContain(p.title);
    }
  });

  test("listed project renders title, owner, tags and favorite count", async ({ page }) => {
    const listed = set.projects.find((p) => p.case === "listed")!;
    await page.goto(`/projects/${listed.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: listed.title }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Alice Fixture").first()).toBeVisible();
    for (const tag of ["#Next.js", "#Postgres"]) await expect(page.getByText(tag, { exact: true }).first()).toBeVisible();
    // UI06: the top bar also says "2 favorites" to screen readers, so look in Project Info.
    await expect(page.locator("#project-info").getByText("2 favorites")).toBeVisible();
  });

  test("an owner whose username is an email address: the page renders without the address", async ({ page }) => {
    const p = set.projects.find((x) => x.case === "ownedByEmailUsername")!;
    const owner = set.personas[p.ownerKey];
    const address = owner.profile!.username;
    // Convex shows the imported handle, never the address.
    const shown = convexImportUsername(owner.subject!, address);
    const res = await page.goto(`/projects/${p.slug}`);
    expect(res!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: p.title }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText(`by ${shown}`, { exact: true }).first()).toBeVisible();
    expect(await res!.text()).not.toContain(address);
    await expect(page.locator("body")).not.toContainText("@synthetic.invalid");
  });

  test("the page is served by the Convex read backend", async ({ request }) => {
    const listed = set.projects.find((p) => p.case === "listed")!;
    const html = await (await request.get(`/projects/${listed.slug}`)).text();
    // The Supabase fixture UUID would appear only if Supabase served the project.
    expect(html.includes(listed.id)).toBe(false);
    // The private fixture stays private.
    const priv = await request.get("/projects/fixture-private");
    expect(priv.status()).toBe(404);
  });

  test("interactions: the owner avatar asks a signed-out visitor to sign in; the contents nav scrolls to a section", async ({ page }) => {
    const listed = set.projects.find((p) => p.case === "listed")!;
    await page.goto(`/projects/${listed.slug}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "View user profile" }).click();
    await expect(page.getByText("You have to be logged in to view user profiles")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/projects/${listed.slug}`);
    // No edit control for a signed-out visitor: the contract carries no owner subject.
    await expect(page.getByRole("button", { name: /Edit Project|Edit/ })).toHaveCount(0);
    await page.getByRole("navigation").getByRole("button", { name: "Timeline" }).click();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeInViewport();
  });
});
