// H1: on the real server, every session-gated API answer reaches the client
// with Cache-Control private + no-store, whatever the handler set, so no CDN
// or shared proxy can keep a signed-in answer. Synthetic account only.
import type { APIRequestContext } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const GATED_GETS = [
  "/api/profiles",
  "/api/profiles/synthetic-nobody",
  "/api/profiles/lookup/synthetic-nobody",
  "/api/docs",
  "/api/docs/h1-no-such-doc/meta",
  "/api/tiers/user-tier",
  "/api/projects/slug/fixture-listed",
  "/api/projects/slug/fixture-listed/linked-doc",
  "/api/projects/h1-no-such-id/tag-submissions",
];
// Past the proxy but no route: Next's own 404 answers no-store (also uncacheable).
const NO_ROUTE = "/api/h1-no-such-endpoint";

async function signedIn(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
  const ctx = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() }, maxRedirects: 0 });
  const email = syntheticEmail("h1-cache");
  expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return ctx;
}

test.describe("H1 cache headers on gated APIs (switch on)", () => {
  test("signed in: every gated GET answer is private and no-store", async ({ playwright }) => {
    const ctx = await signedIn(playwright);
    for (const url of GATED_GETS) {
      const res = await ctx.get(url);
      expect(res.status(), url).not.toBe(401);
      const cc = res.headers()["cache-control"] ?? "";
      expect(cc, url).toContain("private");
      expect(cc, url).toContain("no-store");
      expect(cc, url).not.toMatch(/public|s-maxage/);
    }
    const missing = await ctx.get(NO_ROUTE);
    expect(missing.status()).toBe(404);
    expect(missing.headers()["cache-control"]).toContain("no-store");
    expect(missing.headers()["cache-control"]).not.toMatch(/public|s-maxage/);
    await ctx.dispose();
  });
});
