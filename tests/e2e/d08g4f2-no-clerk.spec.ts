// D08g4f2: the default app makes no request to Clerk. Jose's dev app, with its
// Clerk keys commented out, still loaded clerk-js from an auto-created
// *.clerk.accounts.dev instance and ran Clerk's keyless server action, because
// the root layout's ClerkProvider fell into keyless mode. With ClerkProvider
// gone, no page (signed out or in) may reference Clerk, request it, ship
// clerk-js or the keyless action, or make the server write a .clerk/ folder.
// The test server runs without Clerk keys, as Jose's app does.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { RUNTIME_DIR } from "../support/test-db";
import { BASE_URL, expect, test } from "./support";

const CLERK = /clerk\.accounts\.dev|clerk\.browser\.js|@clerk\/clerk-js|clerk-js@|detectKeylessEnvDrift|keyless/i;
const PAGES = ["/", "/projects", "/sign-in", "/sign-up", "/auth/sign-up", "/categories", "/tags", "/users", "/search"];
const SIGNED_IN_PAGES = ["/dashboard", "/projects/new", "/projects/favorites"];
const root = path.resolve(__dirname, "../..");
const LOG = path.join(RUNTIME_DIR, "next-server.log");
/** Blocked requests, less the fixtures' own synthetic hosts (avatars on *.synthetic.invalid). */
const outside = (blocked: { url: string }[]) => blocked.filter((b) => !new URL(b.url).hostname.endsWith(".invalid"));

/** Visits each path and returns every request URL, and any Clerk reference in the HTML or the scripts it loaded. */
async function visit(page: Page, paths: string[]) {
  const requests: string[] = [];
  const found: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("response", async (r) => {
    const type = r.request().resourceType();
    if (type !== "document" && type !== "script") return;
    const body = await r.text().catch(() => "");
    const hit = body.match(CLERK);
    if (hit) found.push(`${r.url()}: ${hit[0]}`);
  });
  for (const p of paths) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
  }
  return { requests, found };
}

test.describe("D08g4f2: no Clerk in the default app", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ [TEST_CLIENT_IP_HEADER]: freshClientIp() });
  });

  test("signed out: no page requests, ships or names Clerk", async ({ page, blocked }) => {
    const logBefore = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
    const { requests, found } = await visit(page, PAGES);
    expect(requests.length).toBeGreaterThan(PAGES.length); // the pages really loaded their scripts
    expect(requests.filter((u) => /clerk/i.test(u))).toEqual([]);
    expect(outside(blocked), "the pages tried to reach something outside the machine").toEqual([]);
    expect(found).toEqual([]);
    const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").slice(logBefore) : "";
    expect(log.match(/.*(clerk|keyless).*/gi) ?? []).toEqual([]);
    expect(fs.existsSync(path.join(root, ".clerk")), "a .clerk/ folder was written").toBe(false);
  });

  test("signed in: the protected pages don't either", async ({ page, blocked }) => {
    const email = syntheticEmail("g4f2-no-clerk");
    const headers = { origin: BASE_URL };
    expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await verifyEmail(email);
    expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    const { requests, found } = await visit(page, SIGNED_IN_PAGES);
    await expect(page).toHaveURL(new RegExp(`${SIGNED_IN_PAGES.at(-1)}$`)); // signed in: not sent to /sign-in
    expect(requests.filter((u) => /clerk/i.test(u))).toEqual([]);
    expect(outside(blocked)).toEqual([]);
    expect(found).toEqual([]);
  });
});
