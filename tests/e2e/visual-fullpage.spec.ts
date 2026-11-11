// C16: the whole public project page, not just the first viewport, compared
// pixel for pixel with one baseline. The baseline was captured with the
// Supabase read and reviewed by eye; the Convex-served page is compared
// against the same file, so it still matches what the Supabase read showed. Same controls as B06 (visual.spec.ts). The Timeline's
// relative dates ("9mo ago") follow the real clock, so they are masked; C13
// compares the exact timestamps instead. A mask is as wide as its text, so
// when the clock moved "9mo ago" to "10mo ago" every full-page comparison
// failed (found in D01). The masked labels are set to the text the baselines
// were captured with, so the mask box keeps its size whatever today's date is.
import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const set = generateFixtures();
const RELATIVE_DATE = /^\d+\s*\w+ ago$/;

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
    for (const label of await page.getByText(RELATIVE_DATE).all()) {
      await label.evaluate((el) => (el.textContent = "9mo ago"));
    }
    await expect(page).toHaveScreenshot(`project-page-full-${c}.png`, {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      mask: [page.getByText(RELATIVE_DATE)],
    });
  });
}
