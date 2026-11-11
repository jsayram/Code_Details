// UI03: the two global fixes that reach every page (pinch zoom, reduced
// motion) and the foundations scope staying off home's content. UI11 removed
// the design-foundations preview route and its tests.
import type { Page } from "@playwright/test";
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, test } from "./support";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

// UI05: the shared shell now loads the stylesheet on every page, so the
// isolation that matters is that page content outside the shell stays
// unscoped until the page adopts the foundations.
test.describe("isolation from existing pages", () => {
  // UI07 adopted /search and UI09 adopted /sign-in and /about; home is the
  // one page left outside the scope. UI10's particle pause button is the one
  // home control on the foundations ([data-home-control]); the content isn't.
  for (const path of ["/"]) {
    test(`${path} keeps its content outside the foundations scope`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('[data-shell="header"].cd-foundations')).toHaveCount(1);
      const scopedContent = await page.evaluate(() =>
        [...document.querySelectorAll(".cd-foundations")].filter((el) => !el.closest('[data-shell], [data-slot="sidebar-container"], [data-mobile="true"], .cd-theme-switch, [data-home-control]')).length,
      );
      expect(scopedContent).toBe(0);
    });
  }
});

test.describe("global fixes", () => {
  test("pinch zoom is allowed", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toMatch(/width=device-width/);
    expect(content).not.toMatch(/user-scalable|maximum-scale/);
    await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
  });

  async function particlePositions(page: Page) {
    return page.locator('[data-decorative="code-particles"] > *').evaluateAll((els) => els.slice(0, 20).map((el) => { const { transform, top, left } = getComputedStyle(el); return `${top} ${left} ${transform}`; }));
  }

  test("reduced motion: particles stay still, and nothing runs forever except spinners", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-decorative="code-particles"] > *').first()).toBeAttached();
    // The particle set is regenerated once as the theme settles after hydration.
    await page.waitForTimeout(2000);
    const first = await particlePositions(page);
    await page.waitForTimeout(2000);
    expect(await particlePositions(page)).toEqual(first);
    const running = await page.evaluate(() =>
      document.getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity)
        .map((a) => (a.effect as KeyframeEffect).target?.getAttribute("class") ?? "")
        .filter((c) => !c.includes("animate-spin")),
    );
    expect(running).toEqual([]);
  });

  test("normal motion: particles still drift", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page.locator('[data-decorative="code-particles"] > *').first()).toBeAttached();
    await page.waitForTimeout(2000);
    const first = await particlePositions(page);
    await expect.poll(async () => JSON.stringify(await particlePositions(page)) !== JSON.stringify(first), { timeout: 10_000 }).toBe(true);
  });

  test("reduced motion: back to top jumps straight there", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const back = page.getByRole("button", { name: /back to top/i });
    await back.click();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
