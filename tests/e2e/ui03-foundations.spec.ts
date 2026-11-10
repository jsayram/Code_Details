// UI03: the isolated foundations preview, and the two global fixes that reach
// every page (pinch zoom, reduced motion). Synthetic accounts only.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { authState, freshClientIp, setRole, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, overflowingContent, test } from "./support";

const PATH = "/dashboard/admin/design-foundations";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const headers = { origin: BASE_URL };

async function signIn(page: Page, label: string): Promise<string> {
  const email = syntheticEmail(label);
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

async function openAsAdmin(page: Page, label: string) {
  const email = await signIn(page, label);
  await setRole((await authState(email))!.authUserId, "admin");
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Design foundations" })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test.describe("preview route access", () => {
  test("signed out goes to sign-in", async ({ page }) => {
    await page.goto(PATH);
    await expect(page).toHaveURL(/\/sign-in\?redirect_url=/);
  });

  test("a regular account goes to the dashboard", async ({ page }) => {
    await signIn(page, "ui03-regular");
    await page.goto(PATH);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe("preview page", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: one main, one h1, no axe findings`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openAsAdmin(page, `ui03-axe-${scheme}`);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
    });
  }

  test("no sideways overflow from the UI02 extremes at any width", async ({ page }) => {
    await openAsAdmin(page, "ui03-overflow");
    await page.locator("details summary").click();
    // 320 is the WCAG reflow width, 720 and 360 are a 1440 desktop at 200% and 400%.
    for (const [width, height] of [[1440, 900], [1024, 768], [720, 450], [390, 844], [360, 225], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => overflowingContent(page), `width ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
  });

  test("keyboard: every control takes focus and shows a solid outline", async ({ page }) => {
    await openAsAdmin(page, "ui03-keyboard");
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const style = getComputedStyle(el);
        return { name: `${el.tagName}:${el.textContent?.trim().slice(0, 24) || el.id}`, outline: style.outlineStyle, width: parseFloat(style.outlineWidth), inside: !!el.closest(".cd-foundations") };
      });
      if (!focus.inside) continue;
      seen.add(focus.name);
      expect(focus.outline, focus.name).toBe("solid");
      expect(focus.width, focus.name).toBeGreaterThanOrEqual(2);
    }
    for (const name of ["BUTTON:Light", "BUTTON:Compact", "BUTTON:Delete", "INPUT:foundations-title", "SUMMARY:Full 5,000-character unb"]) {
      expect([...seen]).toContain(name);
    }
  });

  test("the dialog traps focus, closes on Escape and hands focus back", async ({ page }) => {
    await openAsAdmin(page, "ui03-dialog");
    const trigger = page.getByRole("button", { name: "Open a dialog" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("compact density shrinks controls and keeps them above the 24px minimum", async ({ page }) => {
    await openAsAdmin(page, "ui03-density");
    const input = page.locator("#foundations-title");
    expect((await input.boundingBox())!.height).toBeCloseTo(44, 0);
    await page.getByRole("button", { name: "Compact" }).click();
    expect((await input.boundingBox())!.height).toBeCloseTo(36, 0);
  });
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
