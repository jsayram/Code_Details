import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const listed = generateFixtures().projects.find((p) => p.case === "listed")!;

// B06: one deterministic visual comparison. Controlled: 1280x800 viewport,
// light theme, reduced motion, CSS animations and the caret off, UTC, en-US,
// synthetic fixture content, and the system font stack (the app loads no web
// fonts). Baselines are per platform (the file name carries -darwin/-linux);
// they are never written automatically (updateSnapshots: "none"). Create or
// change one only with --update-snapshots after looking at the diff.
test("public project page, desktop, light", async ({ page }) => {
  await page.goto(`/projects/${listed.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: listed.title }).filter({ visible: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Let the post-hydration re-render (Phase A D-3) settle before capturing.
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveScreenshot("project-page-desktop-light.png", {
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    maxDiffPixels: 0,
    // The dev-mode indicator ("1 Issue" from the D-3 hydration mismatch) is not app UI.
    mask: [page.locator("nextjs-portal")],
  });
});
