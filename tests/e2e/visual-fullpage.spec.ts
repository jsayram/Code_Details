// C16: the whole public project page, not just the first viewport, compared
// pixel for pixel with one baseline. The baseline was captured with the
// Supabase read and reviewed by eye; running the suite with
// CODEDETAILS_E2E_READ_BACKEND=convex compares the Convex-served page
// against the same file, so any visible difference between the two read
// backends fails here. Same controls as B06 (visual.spec.ts). The Timeline's
// relative dates ("9mo ago") follow the real clock, so they are masked; C13
// compares the exact timestamps instead.
import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const set = generateFixtures();

for (const c of ["listed", "noDescription", "unicode", "fifteenTags"] as const) {
  const p = set.projects.find((x) => x.case === c)!;
  test(`full project page: ${c}`, async ({ page }) => {
    await page.goto(`/projects/${p.slug}`);
    await expect(page.getByRole("heading", { level: 1 }).filter({ visible: true }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    // The dev-mode indicator is fixed-position, so in a full-page capture it
    // covers content (and a mask lands in the wrong place). It isn't app UI.
    await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove()));
    await expect(page).toHaveScreenshot(`project-page-full-${c}.png`, {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      mask: [page.getByText(/^\d+\s*\w+ ago$/)],
    });
  });
}
