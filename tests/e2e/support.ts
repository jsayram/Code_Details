// Shared Playwright fixture for browser tests (B04+). Every request a page
// makes goes through an allowlist: the test server itself and inline data
// (D08g4f2: the signed-out Clerk stub is gone with Clerk). Everything else is
// aborted and recorded, so a test can assert the page tried to reach nothing
// outside the machine.
import { test as base, expect } from "@playwright/test";
import { ACTIVE } from "../support/slot.cjs";

/** The active test slot's Next server (slot 0: 3100). */
export const BASE_URL = `http://localhost:${ACTIVE.nextPort}`;

export interface Blocked {
  url: string;
  resourceType: string;
}

/**
 * D08f2: what counts as a hydration error. React 19 reports a mismatch as
 * "Hydration failed because the server rendered HTML didn't match the client"
 * (console error, or an uncaught page error), and older wording mentions a
 * "hydration mismatch" or text that "did not match".
 */
export const HYDRATION_ERROR = /hydration failed|hydration mismatch|did not match|server rendered (html|text) didn'?t match/i;

export const test = base.extend<{ blocked: Blocked[]; hydrationErrors: string[] }>({
  // D08f2: fails any test whose pages log a hydration error, once the known
  // source (Clerk's SignedOut in the header) is gone. Listens on the context,
  // so request-only tests don't open a page for it.
  hydrationErrors: [
    async ({ context }, use, testInfo) => {
      const errors: string[] = [];
      // FLAKE-HYD-HOME: the whole message too (React lists the differing
      // element as +/- lines below the first), attached to the test and printed
      // to the run's log, so a rare mismatch can be read after the fact.
      const full: string[] = [];
      context.on("console", (m) => {
        if (m.type() === "error" && HYDRATION_ERROR.test(m.text())) {
          errors.push(m.text().split("\n")[0]);
          full.push(`[console.error on ${m.location().url}]\n${m.text()}`);
        }
      });
      context.on("weberror", (e) => {
        const message = e.error().message;
        if (HYDRATION_ERROR.test(message)) {
          errors.push(message.split("\n")[0]);
          full.push(`[page error on ${e.page()?.url() ?? "?"}]\n${e.error().stack ?? message}`);
        }
      });
      await use(errors);
      if (errors.length) {
        testInfo.annotations.push({ type: "hydration-errors", description: errors.join(" | ") });
        await testInfo.attach("hydration-errors.txt", { body: full.join("\n\n"), contentType: "text/plain" });
        console.log(`HYDRATION-ERROR-FULL ${testInfo.titlePath.join(" > ")}\n${full.join("\n\n")}\nHYDRATION-ERROR-END`);
      }
      expect(errors, "the page logged a hydration error").toEqual([]);
    },
    { auto: true },
  ],
  blocked: [
    async ({ context }, use) => {
      const blocked: Blocked[] = [];
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === BASE_URL || url.protocol === "data:" || url.protocol === "blob:") {
          return route.continue();
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
