import type { Locator, Page } from "@playwright/test";
import { generateFixtures } from "../fixtures/generate";
import { expect, horizontalOverflow, overflowingContent, test } from "./support";

const listed = generateFixtures().projects.find((p) => p.case === "listed")!;

/**
 * The control sits fully inside the viewport horizontally. Polls because the
 * project page re-renders after hydration (Phase A, D-3), which briefly
 * detaches elements.
 */
async function expectWithinViewport(page: Page, control: Locator) {
  const width = page.viewportSize()!.width;
  await expect
    .poll(async () => {
      const r = await control.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect).catch(() => null);
      return r !== null && r.width > 0 && r.left >= 0 && r.right <= width;
    })
    .toBe(true);
}

// B05: core controls work by touch on a phone-sized screen, with no sideways scroll.
test.describe("signed out, mobile (Pixel 7 emulation)", () => {
  test("homepage controls are usable and nothing overflows horizontally", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "{ Details }" })).toBeVisible();

    const toggle = page.getByRole("switch", { name: "Toggle theme" });
    const signIn = page.getByRole("button", { name: "Sign In" }).filter({ visible: true }).first();
    for (const control of [toggle, signIn]) {
      await expect(control).toBeVisible();
      await expectWithinViewport(page, control);
    }

    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    expect(await horizontalOverflow(page)).toBe(0);
    expect(await overflowingContent(page)).toEqual([]);
  });

  test("a public project page fits the screen", async ({ page }) => {
    await page.goto(`/projects/${listed.slug}`);
    const heading = page.getByRole("heading", { level: 1, name: listed.title }).filter({ visible: true }).first();
    await expect(heading).toBeVisible();
    await expectWithinViewport(page, heading);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await overflowingContent(page)).toEqual([]);
  });
});
