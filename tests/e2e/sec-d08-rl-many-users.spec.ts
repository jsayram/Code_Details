// SEC-D08-RL in the browser-test app, switch on: the Next.js server's own
// session checks (the proxy's and the routes' token calls) carry no client
// IP. They used to share one rate-limit bucket of 100 a minute on the auth
// site, so with enough traffic every signed-in user read as signed out. Three
// users and 150 server-side checks (more than that bucket held) now all
// resolve to the right account.
import type { APIRequestContext } from "@playwright/test";
import { freshClientIp, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";

async function signedIn(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, label: string) {
  const ctx = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() }, maxRedirects: 0 });
  const email = syntheticEmail(label);
  expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await ctx.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return ctx;
}

test.describe("SEC-D08-RL many users' server-side session checks (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");
  test.setTimeout(180_000);

  test("150 server-side checks across three users never read anyone as signed out", async ({ playwright }) => {
    const users = [await signedIn(playwright, "rl-1"), await signedIn(playwright, "rl-2"), await signedIn(playwright, "rl-3")];
    const handles = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const res = await users[i % 3].get("/api/dev/viewer");
      expect(res.status(), `check ${i}`).toBe(200);
      const { viewer } = (await res.json()) as { viewer: { username: string } | null };
      expect(viewer, `check ${i}`).not.toBeNull();
      handles.add(viewer!.username);
    }
    expect(handles.size).toBe(3);
    for (const u of users) await u.dispose();
  });
});
