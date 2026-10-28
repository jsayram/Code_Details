// Shared Playwright fixture for browser tests (B04+). Every request a page
// makes goes through an allowlist: the test server itself, inline data, and the
// signed-out Clerk stub. Everything else is aborted and recorded, so a test can
// assert the page tried to reach nothing outside the machine.
import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export const BASE_URL = "http://localhost:3100";
const CLERK_STUB = fs.readFileSync(path.join(__dirname, "clerk-signed-out-stub.js"), "utf8");

export interface Blocked {
  url: string;
  resourceType: string;
}

export const test = base.extend<{ blocked: Blocked[] }>({
  blocked: [
    async ({ context }, use) => {
      const blocked: Blocked[] = [];
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === BASE_URL || url.protocol === "data:" || url.protocol === "blob:") {
          return route.continue();
        }
        if (url.hostname.endsWith(".invalid") && /\/npm\/@clerk\/clerk-js@[^/]+\/dist\/clerk\.browser\.js$/.test(url.pathname)) {
          return route.fulfill({ status: 200, contentType: "application/javascript", body: CLERK_STUB });
        }
        blocked.push({ url: `${url.protocol}//${url.host}${url.pathname}`, resourceType: request.resourceType() });
        return route.abort("blockedbyclient");
      });
      await use(blocked);
    },
    { auto: true },
  ],
});

export { expect };

/** Pixels the page scrolls sideways; 0 means no horizontal overflow. */
export async function horizontalOverflow(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Visible elements carrying text or an interactive role that extend past the
 * viewport sideways. body has overflow-x: hidden, so scrollWidth alone can hide
 * clipped content. Decorative layers don't count: empty ones (the homepage's
 * 120%-wide background) and non-interactive ones with pointer-events: none
 * (the floating code particles).
 */
export async function overflowingContent(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const interactive = "a, button, input, select, textarea, [role]";
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      const isInteractive = el.matches(interactive);
      if (!ownText && !isInteractive) continue;
      if (!isInteractive && style.pointerEvents === "none") continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.left < -1 || box.right > width + 1) {
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(box.left)}..${Math.round(box.right)}`);
      }
    }
    return out;
  });
}
