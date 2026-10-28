// Phase C: the public project page for signed-out visitors, whichever read
// backend serves it. Not-found must not reveal whether a project exists:
// deleted and missing slugs give the same status and the same page.
import { generateFixtures } from "../fixtures/generate";
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
    await expect(page.getByText("2 favorites")).toBeVisible();
  });
});
