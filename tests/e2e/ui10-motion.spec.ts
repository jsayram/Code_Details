// UI10: motion inside the budget. Home's particles (count, pause, reduced
// motion, never in the way), the hero readable from the start, overlays on
// the duration tokens, and focus that follows scripted jumps.
import AxeBuilder from "@axe-core/playwright";
import { freshClientIp, TEST_CLIENT_IP_HEADER } from "../fixtures/better-auth";
import { expect, test } from "./support";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LAYER = '[data-decorative="code-particles"]';

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
});

test("home: 18 code symbols drift, pause on the button, and leave every control clickable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const layer = page.locator(LAYER);
  await expect(layer.locator(".cd-particle")).toHaveCount(18);
  await expect(layer).toHaveAttribute("data-running", "true");
  await expect(layer).toHaveCSS("pointer-events", "none");
  expect(await layer.locator(".cd-particle").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("cd-particle-drift");

  const pause = page.getByRole("button", { name: "Pause background animation" });
  await pause.click();
  await expect(layer).toHaveAttribute("data-running", "false");
  expect(await layer.locator(".cd-particle").first().evaluate((el) => getComputedStyle(el).animationPlayState)).toBe("paused");
  // The choice survives a reload in this browser.
  await page.reload();
  await expect(page.getByRole("button", { name: "Play background animation" })).toBeVisible();
  await expect(layer).toHaveAttribute("data-running", "false");
  await page.getByRole("button", { name: "Play background animation" }).click();
  await expect(layer).toHaveAttribute("data-running", "true");

  // Nothing decorative sits between the pointer and a visible control.
  const blocked = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("a[href], button, [role=switch]")) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight) continue;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (hit && !el.contains(hit) && !hit.contains(el)) bad.push(`${el.textContent?.trim()} <- ${hit.className}`);
    }
    return bad;
  });
  expect(blocked).toEqual([]);
});

test("home: a hidden tab pauses the particles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const layer = page.locator(LAYER);
  await expect(layer).toHaveAttribute("data-running", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(layer).toHaveAttribute("data-running", "false");
});

test("home with reduced motion: particles stand still and the pause button is gone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(LAYER).locator(".cd-particle")).toHaveCount(18);
  expect(await page.locator(`${LAYER} .cd-particle`).first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(page.getByRole("button", { name: /background animation/ })).toBeHidden();
  // The typed label shows whole.
  const typed = page.locator(".cd-typing").first();
  await expect(typed).toHaveText("sudo --authenticate user");
  expect(await typed.evaluate((el) => getComputedStyle(el).clipPath)).toBe("none");
});

test("home: the hero is readable at once and the typed label is whole in the page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".cd-typing").first()).toHaveText("sudo --authenticate user");
  // Entries start at 0.8 opacity, never 0.
  const minOpacity = await page.locator(".cd-enter").evaluateAll((els) => Math.min(...els.map((el) => Number(getComputedStyle(el).opacity))));
  expect(minOpacity).toBeGreaterThanOrEqual(0.8);
  // The full-screen pulsing glow is gone.
  expect(await page.locator(".blur-2xl.animate-pulse").count()).toBe(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG).include('[data-testid="particles-toggle"]').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("project page: On This Page moves focus to the section it scrolls to", async ({ page }) => {
  await page.goto("/projects/fixture-listed");
  const toc = page.locator('nav[aria-labelledby="toc-heading-desktop"]');
  await toc.getByRole("button", { name: "About" }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("about");
});

test("back to top takes focus to the start of the content", async ({ page }) => {
  await page.goto("/tags");
  const back = page.getByRole("button", { name: "Back to top" });
  await back.scrollIntoViewIfNeeded();
  await back.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main-content");
});

test("overlay duration tokens resolve for menus and dialogs", async ({ page }) => {
  // No signed-out menu or dialog opens on desktop, so read the rule the
  // browser resolves for a synthetic overlay carrying the real data-slot.
  await page.goto("/tags");
  const durations = await page.evaluate(() => {
    const read = (slot: string, state: string) => {
      const el = document.createElement("div");
      el.setAttribute("data-slot", slot);
      el.setAttribute("data-state", state);
      el.className = "data-[state=open]:animate-in data-[state=closed]:animate-out";
      document.body.append(el);
      // Tailwind registers --tw-duration as a <time>, so it reads back in seconds.
      const raw = getComputedStyle(el).getPropertyValue("--tw-duration").trim();
      el.remove();
      return raw.endsWith("ms") ? parseFloat(raw) : Math.round(parseFloat(raw) * 1000);
    };
    return [read("dropdown-menu-content", "open"), read("dropdown-menu-content", "closed"), read("dialog-content", "open"), read("dialog-content", "closed")];
  });
  expect(durations).toEqual([180, 144, 240, 192]);
});
