// D08b: Better Auth through the Next.js app. With the development switch on
// (CODEDETAILS_E2E_AUTH_BACKEND=better-auth), /api/auth/* on the app origin
// forwards to the local Convex backend's site port, cookies land on the app
// origin, and server code (/api/dev/viewer) reads as the session's user the
// way a server component will. With the switch off (the normal runs), none of
// it exists. Synthetic users only; Clerk stays the app's login in both.
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { SYNTHETIC_PASSWORD, expireSession, syntheticEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
// D08c: a new account has a generated handle.
const NEW_ACCOUNT = { username: expect.stringMatching(/^user-[0-9a-z]{6}$/), role: "user", tier: "free" };

/** One browser's worth of cookies, sending the app origin like a same-site fetch. */
async function browserLike(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, origin = BASE_URL) {
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin } });
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

test.describe("D08b Better Auth through /api/auth (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test("sign-up sets the session cookie on the app origin, and server code sees the new account", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    const res = await ctx.post("/api/auth/sign-up/email", { data: { email: syntheticEmail("next-signup"), password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } });
    expect(res.status()).toBe(200);
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
    expect((await signup.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
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
    expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    const res = await ctx.post("/api/auth/sign-out", { data: {}, headers: { origin: "http://evil.synthetic.invalid" } });
    expect(res.status()).toBe(403);
    expect(await viewer(ctx)).toEqual(NEW_ACCOUNT); // still signed in
    await ctx.dispose();
  });

  test("refresh: a session near its end is extended by get-session", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    expect((await ctx.post("/api/auth/sign-up/email", { data: { email: syntheticEmail("next-refresh"), password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
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
      expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
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

  test("/api/auth/sync-user is still the Clerk route, not Better Auth's", async ({ request }) => {
    // Signed out, the Clerk route refuses with its own 401 JSON; the Better Auth
    // catch-all would have answered 404 for an unknown endpoint.
    const res = await request.post("/api/auth/sync-user", { headers: { origin: BASE_URL } });
    expect(res.status()).toBe(401);
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

test.describe("D08d handover route, signed out (either switch state)", () => {
  test("Clerk's protect sends a signed-out call to /sign-in; nothing is linked", async ({ playwright }) => {
    const ctx = await browserLike(playwright);
    // A Better Auth session alone is not enough: the Clerk side is missing.
    if (betterAuth) {
      expect((await ctx.post("/api/auth/sign-up/email", { data: { email: syntheticEmail("next-handover"), password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    }
    const res = await ctx.post("/api/account/handover", { data: {}, maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers().location, BASE_URL).pathname).toBe("/sign-in");
    if (betterAuth) expect(await viewer(ctx)).toEqual(NEW_ACCOUNT);
    await ctx.dispose();
  });
});

