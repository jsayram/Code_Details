// D08b: Better Auth through the Next.js app. With the development switch on
// (CODEDETAILS_E2E_AUTH_BACKEND=better-auth), /api/auth/* on the app origin
// forwards to the local Convex backend's site port, cookies land on the app
// origin, and server code (/api/dev/viewer) reads as the session's user the
// way a server component will. With the switch off (the normal runs), none of
// it exists. Synthetic users only; Clerk stays the app's login in both.
import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expireSession, freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { fakeMailpit, linkIn, revealsAddress } from "../fixtures/fake-mailpit";
import { RUNTIME_DIR } from "../support/test-db";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
// D08c: a new account has a generated handle.
const NEW_ACCOUNT = { username: expect.stringMatching(/^user-[0-9a-z]{6}$/), role: "user", tier: "free" };

/**
 * One browser's worth of cookies, sending the app origin like a same-site
 * fetch. D08e: each gets its own client IP, so Better Auth's limiter sees one
 * client per context. SEC-D08-XFF: that is the test backend's test-only
 * client-IP header; a browser-supplied X-Forwarded-For is dropped.
 */
async function browserLike(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, origin = BASE_URL, ip = freshClientIp()) {
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin, [TEST_CLIENT_IP_HEADER]: ip } });
}

// The Convex adapter returns dates as epoch milliseconds; Better Auth's own
// adapters return ISO strings. Accept both.
const ms = (value: number | string) => (typeof value === "number" ? value : Date.parse(value));
type SessionBody = { session: { id: string; expiresAt: number | string } };

const setCookies = (res: APIResponse) => res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
const viewer = async (ctx: APIRequestContext) => {
  const res = await ctx.get("/api/dev/viewer");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { viewer: unknown }).viewer;
};

/**
 * D08e: sign-up through the app starts no session until the address is
 * verified. Verify through the fixture (the emailed link is tested in
 * d08e-login-methods) and sign in, in the same cookie jar.
 */
async function signUpAndIn(ctx: APIRequestContext, email: string): Promise<APIResponse> {
  const up = await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } });
  expect(up.status()).toBe(200);
  expect(setCookies(up).some((c) => c.startsWith("better-auth.session_token=") && !/max-age=0/i.test(c))).toBe(false);
  await verifyEmail(email);
  const signIn = await ctx.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } });
  expect(signIn.status()).toBe(200);
  return signIn;
}

test.describe("D08b Better Auth through /api/auth (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test("sign-in after a verified sign-up sets the session cookie on the app origin, and server code sees the new account", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    const res = await signUpAndIn(ctx, syntheticEmail("next-signup"));
    const session = setCookies(res).find((c) => c.startsWith("better-auth.session_token="));
    expect(session).toBeDefined();
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).toMatch(/;\s*SameSite=Lax/i);
    expect(session).toMatch(/;\s*Path=\//i);
    expect(session).not.toMatch(/;\s*Secure/i); // plain http on loopback only
    expect(session).not.toMatch(/;\s*Domain=/i); // host-only cookie
    expect(await viewer(ctx)).toEqual(NEW_ACCOUNT);
    await ctx.dispose();
  });

  test("sign-in and sign-out: the server stops seeing the user after sign-out", async ({ playwright }) => {
    const email = syntheticEmail("next-signout");
    const signup = await browserLike(playwright);
    await signUpAndIn(signup, email);
    await signup.dispose();

    const ctx = await browserLike(playwright);
    expect(await viewer(ctx)).toBeNull();
    expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    expect(await viewer(ctx)).toEqual(NEW_ACCOUNT);
    expect((await ctx.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
    expect(await viewer(ctx)).toBeNull();
    await ctx.dispose();
  });

  test("a wrong password gets 401 and no session", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    const res = await ctx.post("/api/auth/sign-in/email", { data: { email: syntheticEmail("next-nobody"), password: SYNTHETIC_PASSWORD } });
    expect(res.status()).toBe(401);
    expect(setCookies(res).some((c) => c.startsWith("better-auth.session_token=") && !/max-age=0/i.test(c))).toBe(false);
    expect(await viewer(ctx)).toBeNull();
    await ctx.dispose();
  });

  test("a cookie-carrying request from a foreign origin is refused", async ({ playwright }) => {
    const email = syntheticEmail("next-origin");
    const ctx = await browserLike(playwright);
    await signUpAndIn(ctx, email);
    const res = await ctx.post("/api/auth/sign-out", { data: {}, headers: { origin: "http://evil.synthetic.invalid" } });
    expect(res.status()).toBe(403);
    expect(await viewer(ctx)).toEqual(NEW_ACCOUNT); // still signed in
    await ctx.dispose();
  });

  test("refresh: a session near its end is extended by get-session", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    await signUpAndIn(ctx, syntheticEmail("next-refresh"));
    const first = (await (await ctx.get("/api/auth/get-session")).json()) as SessionBody;
    const soon = Date.now() + 60 * 60 * 1000; // one hour left of a 7-day session
    await expireSession(first.session.id, soon);
    const res = await ctx.get("/api/auth/get-session");
    expect(res.status()).toBe(200);
    const refreshed = (await res.json()) as SessionBody;
    expect(refreshed.session.id).toBe(first.session.id);
    expect(ms(refreshed.session.expiresAt)).toBeGreaterThan(soon + 24 * 60 * 60 * 1000);
    expect(setCookies(res).some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
    expect(await viewer(ctx)).toEqual(NEW_ACCOUNT);
    await ctx.dispose();
  });

  test("D08c: switching accounts in one browser through the app origin", async ({ playwright }) => {
    const [a, b] = [syntheticEmail("next-switch-a"), syntheticEmail("next-switch-b")];
    for (const email of [a, b]) {
      const ctx = await browserLike(playwright);
      await signUpAndIn(ctx, email);
      await ctx.dispose();
    }
    const ctx = await browserLike(playwright);
    expect((await ctx.post("/api/auth/sign-in/email", { data: { email: a, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    const asA = (await viewer(ctx)) as { username: string };
    expect((await ctx.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
    expect((await ctx.post("/api/auth/sign-in/email", { data: { email: b, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    const asB = (await viewer(ctx)) as { username: string };
    expect(asB).toEqual(NEW_ACCOUNT);
    expect(asB.username).not.toBe(asA.username);
    await ctx.dispose();
  });

  test("D08e: through the app, the 11th sign-in attempt in a minute from one client gets 429", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await ctx.post("/api/auth/sign-in/email", { data: { email: syntheticEmail("next-rl"), password: "wrong-Password-1" } })).status());
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    const other = await browserLike(playwright);
    expect((await other.post("/api/auth/sign-in/email", { data: { email: syntheticEmail("next-rl2"), password: "wrong-Password-1" } })).status()).toBe(401);
    await ctx.dispose();
    await other.dispose();
  });

  test("/api/auth/sync-user is still the Clerk route, not Better Auth's", async ({ request }) => {
    // Signed out, the Clerk route refuses with its own 401 JSON; the Better Auth
    // catch-all would have answered 404 for an unknown endpoint.
    const res = await request.post("/api/auth/sync-user", { headers: { origin: BASE_URL } });
    expect(res.status()).toBe(401);
  });
});

test.describe("D08f1: emailed links never put the address in a logged URL (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");
  const mailbox = fakeMailpit();
  const LOG = path.join(RUNTIME_DIR, "next-server.log");

  test.beforeAll(async () => {
    await mailbox.start();
  });
  test.afterAll(async () => {
    await mailbox.stop();
  });

  test("verification and reset links followed through the app leave no trace of the address in the server log", async ({ playwright }) => {
    const email = syntheticEmail("next-logged");
    const ctx = await browserLike(playwright);
    expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    const [verify] = await mailbox.waitFor(email, "verify-email");
    const verifyLink = linkIn(verify);
    const verified = await ctx.get(`${verifyLink.pathname}${verifyLink.search}`, { maxRedirects: 0 });
    expect(verified.status()).toBe(302);
    expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);

    expect((await ctx.post("/api/auth/request-password-reset", { data: { email, redirectTo: "/reset-password" } })).status()).toBe(200);
    const [reset] = await mailbox.waitFor(email, "reset-password");
    const resetLink = linkIn(reset);
    const toForm = await ctx.get(`${resetLink.pathname}${resetLink.search}`, { maxRedirects: 0 });
    expect(toForm.status()).toBe(302);
    const token = new URL(toForm.headers().location, BASE_URL).searchParams.get("token")!;
    expect((await ctx.post("/api/auth/reset-password", { data: { token, newPassword: "synthetic-New-Password-456" } })).status()).toBe(200);
    await ctx.dispose();

    // Next.js writes its request log lines asynchronously.
    await new Promise((r) => setTimeout(r, 500));
    const log = fs.readFileSync(LOG, "utf8");
    expect(log).toContain("/api/auth/reset-password/"); // the log is really being captured
    expect(revealsAddress(log, email), "the server log reveals the address").toBe(false);
    expect(log).toContain("/api/auth/email-link?code=");
    for (const mail of [verify, reset]) expect(revealsAddress(linkIn(mail).href, email)).toBe(false);
  });
});

test.describe("D08b with the switch off", () => {
  test.skip(betterAuth, "only without CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test("Better Auth's endpoints and the dev viewer don't exist", async ({ request }) => {
    for (const [method, path] of [
      ["post", "/api/auth/sign-in/email"],
      ["post", "/api/auth/sign-up/email"],
      ["get", "/api/auth/get-session"],
      ["get", "/api/auth/convex/token"],
      ["get", "/api/dev/viewer"],
    ] as const) {
      const res = await request[method](path, { headers: { origin: BASE_URL }, maxRedirects: 0 });
      // Behind Clerk as before: a signed-out call is sent to /sign-in by
      // Clerk's protect (or would get the route's own 404), never served.
      expect([307, 404], `${method} ${path}`).toContain(res.status());
      if (res.status() === 307) expect(new URL(res.headers().location, BASE_URL).pathname, `${method} ${path}`).toBe("/sign-in");
      expect(setCookies(res).filter((c) => c.startsWith("better-auth.")), `${method} ${path}`).toEqual([]);
    }
  });
});

test.describe("D08g4b: the D08d handover route is gone (either switch state)", () => {
  test("POST /api/account/handover is not served; nothing is linked", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    if (betterAuth) await signUpAndIn(ctx, syntheticEmail("next-handover"));
    const res = await ctx.post("/api/account/handover", { data: {}, maxRedirects: 0 });
    if (betterAuth) {
      // Signed in, the proxy lets it through and there is no such route.
      expect(res.status()).toBe(404);
      expect(await viewer(ctx)).toEqual(NEW_ACCOUNT);
    } else {
      // Default (Clerk) mode, unchanged: Clerk's protect redirects, or the 404 shows.
      expect([307, 404]).toContain(res.status());
      if (res.status() === 307) expect(new URL(res.headers().location, BASE_URL).pathname).toBe("/sign-in");
    }
    await ctx.dispose();
  });
});

