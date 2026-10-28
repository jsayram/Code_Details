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
