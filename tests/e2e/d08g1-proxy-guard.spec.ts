// D08g1: with the development switch on, src/proxy.ts lets Better Auth
// sessions through protected routes and keeps everyone else out, without
// Clerk. Synthetic users; the paths below that don't exist answer 404 once
// past the proxy, which tells "passed the proxy" apart from its own refusal.
import type { APIRequestContext } from "@playwright/test";
import { expireSession, freshClientIp, setRole, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
const PAGE = "/d08g1-no-such-page";
const API = "/api/d08g1-no-such-endpoint";

async function client(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() }, maxRedirects: 0 });
}

async function signIn(ctx: APIRequestContext) {
  const email = syntheticEmail("g1-proxy");
  expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  const session = (await (await ctx.get("/api/auth/get-session")).json()) as { user: { id: string }; session: { id: string } };
  return { userId: session.user.id, sessionId: session.session.id };
}

test.describe("D08g1 proxy guard (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");

  test("signed out: pages go to /sign-in with redirect_url, APIs answer 401, public routes pass", async ({ playwright }) => {
    const ctx = await client(playwright);
    const page = await ctx.get(`${PAGE}?a=1`);
    expect(page.status()).toBe(307);
    expect(page.headers().location).toBe(`/sign-in?redirect_url=${encodeURIComponent(`${PAGE}?a=1`)}`);
    const dashboard = await ctx.get("/dashboard");
    expect(new URL(dashboard.headers().location, BASE_URL).pathname).toBe("/sign-in");
    const api = await ctx.get(API);
    expect(api.status()).toBe(401);
    expect(await api.json()).toEqual({ error: "Unauthorized" });
    expect((await ctx.get("/")).status()).toBe(200);
    expect((await ctx.get("/projects/fixture-listed")).status()).toBe(200);
    expect((await ctx.get("/sign-in")).status()).toBe(200);
    await ctx.dispose();
  });

  test("signed in: protected pages and APIs pass the proxy; an expired session is signed out again", async ({ playwright }) => {
    const ctx = await client(playwright);
    const { sessionId } = await signIn(ctx);
    expect((await ctx.get(PAGE)).status()).toBe(404);
    expect((await ctx.get(API)).status()).toBe(404);
    expect((await ctx.get("/dashboard")).headers().location ?? "").not.toMatch(/sign-in/);
    await expireSession(sessionId);
    expect((await ctx.get(API)).status()).toBe(401);
    expect((await ctx.get(PAGE)).headers().location).toMatch(/^\/sign-in\?redirect_url=/);
    await ctx.dispose();
  });

  test("admin routes: a regular account goes to /dashboard, an admin gets through", async ({ playwright }) => {
    const ctx = await client(playwright);
    const { userId } = await signIn(ctx);
    const refused = await ctx.get("/dashboard/admin");
    expect(refused.status()).toBe(307);
    expect(refused.headers().location).toBe("/dashboard");
    await setRole(userId, "admin");
    const allowed = await ctx.get("/dashboard/admin");
    expect(allowed.headers().location ?? "").not.toMatch(/^\/(dashboard|sign-in)/);
    await ctx.dispose();
  });

  test("a forged session cookie counts as signed out", async ({ playwright }) => {
    const ctx = await client(playwright);
    const res = await ctx.get(API, { headers: { cookie: "better-auth.session_token=forged.value" } });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
