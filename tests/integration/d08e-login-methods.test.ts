// D08e: the first release's login methods on the task-owned local backend,
// without any real provider. Email/password with required verification and
// reset, with emails caught by a fake Mailpit send API in this process
// (127.0.0.1:3299, where tests/convex/push.mjs points the test backend).
// GitHub configured with synthetic credentials, so only what Better Auth does
// before contacting GitHub is checked here; the real round trip is a manual
// check with Jose (D08_PLAN e9). Rate limits, and the coordinator's condition:
// a completed sign-up of every enabled method survives the half-finished repair.
import type { AddressInfo } from "node:net";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, clearConvexFixtures, convexAvailable } from "../fixtures/convex";
import { testIssuerAvailable } from "../fixtures/convex-auth";
import { FAKE_MAILPIT_PORT, fakeMailpit, linkIn, revealsAddress } from "../fixtures/fake-mailpit";
import {
  SITE_ORIGIN,
  SYNTHETIC_PASSWORD,
  accountRows,
  authFetch,
  authState,
  clientWithToken,
  freshClientIp,
  convexToken,
  repairHalfFinishedSignUps,
  signIn,
  signUpRaw,
  syntheticEmail,
  type Jar,
} from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";

const whoami = makeFunctionReference<"query">("identity:whoami");
const simulateGithubSignUp = makeFunctionReference<"mutation", { email: string; githubId: string }>("fixtures:simulateGithubSignUp");

const mailbox = fakeMailpit();
const mailFor = mailbox.mailFor;
/** The emailed link points at the app origin; the test calls the backend's site port with the same path. */
const onBackend = (link: URL) => `${link.pathname.replace(/^\/api\/auth/, "")}${link.search}`;

const waitForMail = (to: string, tag: string, count = 1) => mailbox.waitFor(to, tag, count);

async function me(jar: Jar) {
  const token = await convexToken(jar);
  return token ? clientWithToken(token).query(whoami, {}) : null;
}

async function verifiedUser(label: string) {
  const email = syntheticEmail(label);
  expect((await signUpRaw(email, SYNTHETIC_PASSWORD)).status).toBe(200);
  const [mail] = await waitForMail(email, "verify-email");
  expect((await authFetch(onBackend(linkIn(mail)), { method: "GET" })).status).toBeLessThan(400);
  return email;
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D08e login methods", () => {
  beforeAll(async () => {
    await mailbox.start();
    expect((mailbox.server.address() as AddressInfo).port).toBe(FAKE_MAILPIT_PORT);
    await clearConvexFixtures();
  });

  afterAll(async () => {
    await clearConvexFixtures();
    await mailbox.stop();
  });

  beforeEach(() => {
    mailbox.inbox.length = 0;
  });

  describe("email verification (required)", () => {
    it("sign-up sends one verification email and starts no session", async () => {
      const email = syntheticEmail("verify-send");
      const res = await signUpRaw(email, SYNTHETIC_PASSWORD, "Ada Lovelace");
      expect(res.status).toBe(200);
      expect(res.jar.has("better-auth.session_token")).toBe(false);
      const mails = await waitForMail(email, "verify-email");
      expect(mails).toHaveLength(1);
      const link = linkIn(mails[0]);
      expect(link.origin).toBe(SITE_ORIGIN);
      // D08f1 (f5): an opaque single-use code, not Better Auth's JWT.
      expect(link.pathname).toBe("/api/auth/email-link");
      expect([...link.searchParams.keys()]).toEqual(["code"]);
      expect(link.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(link.href).not.toContain("eyJ");
      expect(revealsAddress(link.href, email)).toBe(false);
      // The body is the link and fixed text: no name, no other address.
      expect(mails[0].text).not.toContain("Ada");
      expect(mails[0].text.match(/@/g) ?? []).toHaveLength(0);
      expect(mails[0].from).toBe("no-reply@codedetails.invalid");
    });

    it("sign-in is refused until the link is used, and re-sends the email", async () => {
      const email = syntheticEmail("verify-gate");
      await signUpRaw(email, SYNTHETIC_PASSWORD);
      await waitForMail(email, "verify-email");
      const early = await signIn(email, SYNTHETIC_PASSWORD);
      expect(early.status).toBe(403);
      expect(early.body).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
      expect(early.jar.has("better-auth.session_token")).toBe(false);
      expect(await waitForMail(email, "verify-email", 2)).toHaveLength(2);
    });

    it("the link verifies the address; then sign-in works and resolves to the account", async () => {
      const email = await verifiedUser("verify-ok");
      expect((await authState(email))!.users).toHaveLength(1);
      const res = await signIn(email, SYNTHETIC_PASSWORD);
      expect(res.status).toBe(200);
      expect(await me(res.jar)).toMatchObject({ role: "user", tier: "free" });
    });

    it("a tampered, malformed or reused link is refused (D08f1)", async () => {
      const email = syntheticEmail("verify-tamper");
      await signUpRaw(email, SYNTHETIC_PASSWORD);
      const [mail] = await waitForMail(email, "verify-email");
      const link = linkIn(mail);
      const code = link.searchParams.get("code")!;
      for (const bad of [`${code.slice(0, -4)}AAAA`, "short", `${code}x`, ""]) {
        const wrong = new URL(link);
        wrong.searchParams.set("code", bad);
        const res = await authFetch(onBackend(wrong), { method: "GET" });
        expect(res.status).toBe(302);
        expect(res.location).toBe("/api/auth/error?error=invalid_link");
      }
      expect((await signIn(email, SYNTHETIC_PASSWORD)).status).toBe(403);
      // The real code still works once, then never again.
      expect((await authFetch(onBackend(link), { method: "GET" })).location).toBe("/");
      expect((await authFetch(onBackend(link), { method: "GET" })).location).toBe("/api/auth/error?error=invalid_link");
      expect((await signIn(email, SYNTHETIC_PASSWORD)).status).toBe(200);
    });

    it("a link keeps the sign-up's own callback path, never another origin", async () => {
      for (const [callbackURL, expected] of [["/welcome", "/welcome"], ["https://evil.synthetic.invalid/", null]] as const) {
        const email = syntheticEmail("verify-callback");
        const res = await authFetch("/sign-up/email", { body: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person", callbackURL } });
        if (expected === null) {
          expect(res.status).toBe(403);
          continue;
        }
        const [mail] = await waitForMail(email, "verify-email");
        expect((await authFetch(onBackend(linkIn(mail)), { method: "GET" })).location).toBe(expected);
      }
    });
  });

  describe("password reset", () => {
    it("answers the same for a known and an unknown address, and only mails the known one", async () => {
      const known = await verifiedUser("reset-known");
      const unknown = syntheticEmail("reset-unknown");
      const a = await authFetch("/request-password-reset", { body: { email: known, redirectTo: "/reset-password" } });
      const b = await authFetch("/request-password-reset", { body: { email: unknown, redirectTo: "/reset-password" } });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body).toEqual(b.body);
      expect(await waitForMail(known, "reset-password")).toHaveLength(1);
      expect(mailFor(unknown, "reset-password")).toHaveLength(0);
    });

    it("the link sets a new password, the old one stops working, other sessions end, the link works once", async () => {
      const email = await verifiedUser("reset-flow");
      const before = await signIn(email, SYNTHETIC_PASSWORD);
      const beforeToken = (await convexToken(before.jar))!;
      expect(await clientWithToken(beforeToken).query(whoami, {})).not.toBeNull();

      await authFetch("/request-password-reset", { body: { email, redirectTo: "/reset-password" } });
      const [mail] = await waitForMail(email, "reset-password");
      const token = linkIn(mail).pathname.split("/").pop()!;
      const newPassword = "synthetic-New-Password-456";
      expect((await authFetch("/reset-password", { body: { token, newPassword } })).status).toBe(200);

      expect((await signIn(email, SYNTHETIC_PASSWORD)).status).toBe(401);
      expect((await signIn(email, newPassword)).status).toBe(200);
      expect(await clientWithToken(beforeToken).query(whoami, {})).toBeNull();
      expect((await authFetch("/reset-password", { body: { token, newPassword: "synthetic-Third-Password-789" } })).status).toBeGreaterThanOrEqual(400);
    });

    it("refuses a redirect to another origin", async () => {
      const email = await verifiedUser("reset-redirect");
      const res = await authFetch("/request-password-reset", { body: { email, redirectTo: "https://evil.synthetic.invalid/reset" } });
      expect(res.status).toBe(403);
    });
  });

  describe("GitHub (synthetic client; nothing is fetched from GitHub)", () => {
    it("builds an authorization URL with our callback, state and PKCE", async () => {
      const res = await authFetch("/sign-in/social", { body: { provider: "github", callbackURL: "/" } });
      expect(res.status).toBe(200);
      const url = new URL((res.body as { url: string }).url);
      expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("SYNTHETIC-github-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(`${SITE_ORIGIN}/api/auth/callback/github`);
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["read:user", "user:email"]);
      expect(res.setCookies.some((c) => c.startsWith("better-auth.state="))).toBe(true);
    });

    it("connecting GitHub is explicit: only while signed in (4A)", async () => {
      // A GitHub sign-in whose email already has an account is refused at the
      // callback (disableImplicitLinking; error=account_not_linked). That needs
      // a real GitHub callback, so it is part of Jose's manual check. What is
      // testable here: connecting from settings needs a session.
      const email = await verifiedUser("connect");
      const signedIn = await signIn(email, SYNTHETIC_PASSWORD);
      const connect = await authFetch("/link-social", { body: { provider: "github", callbackURL: "/" }, jar: signedIn.jar });
      expect(connect.status).toBe(200);
      expect(new URL((connect.body as { url: string }).url).hostname).toBe("github.com");
      expect((await authFetch("/link-social", { body: { provider: "github", callbackURL: "/" } })).status).toBe(401);
    });

    it("refuses a callback URL on another origin", async () => {
      const res = await authFetch("/sign-in/social", { body: { provider: "github", callbackURL: "https://evil.synthetic.invalid/" } });
      expect(res.status).toBe(403);
    });

    it("a callback with a state it didn't issue is sent to the error page and creates nobody", async () => {
      const res = await fetch(`${TEST_CONVEX_SITE_URL}/api/auth/callback/github?code=synthetic&state=forged`, {
        redirect: "manual",
        headers: { "x-forwarded-for": "2001:db8:e5::1" },
      });
      expect(res.status).toBe(302);
      // D08f3b: the app's own error screen, as a relative redirect on the origin the browser came through.
      const location = new URL(res.headers.get("location")!, "http://origin.invalid");
      expect(location.origin).toBe("http://origin.invalid");
      expect(location.pathname).toBe("/sign-in/error");
      expect(location.searchParams.get("error")).toBe("state_mismatch");
    });
  });

  describe("rate limits (per client IP)", () => {
    it("the 11th sign-in attempt in a minute from one IP gets 429; another IP doesn't", async () => {
      const ip = freshClientIp();
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) codes.push((await authFetch("/sign-in/email", { body: { email: syntheticEmail("rl"), password: "wrong-Password-1" }, ip })).status);
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes[10]).toBe(429);
      expect((await authFetch("/sign-in/email", { body: { email: syntheticEmail("rl2"), password: "wrong-Password-1" }, ip: freshClientIp() })).status).toBe(401);
    });

    it("password-reset requests are limited to 3 per 5 minutes per IP", async () => {
      const ip = freshClientIp();
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await authFetch("/request-password-reset", { body: { email: syntheticEmail("rl-reset"), redirectTo: "/reset-password" }, ip })).status);
      expect(codes).toEqual([200, 200, 200, 429]);
    });
  });

  describe("coordinator condition: completed sign-ups of every enabled method survive the repair", () => {
    const window = () => ({ createdBefore: Date.now() + 1000, createdAfter: Date.now() - 60 * 60 * 1000 });

    it("email/password, before and after verification", async () => {
      const unverified = syntheticEmail("survive-unverified");
      await signUpRaw(unverified, SYNTHETIC_PASSWORD);
      const verified = await verifiedUser("survive-verified");
      await repairHalfFinishedSignUps(window());
      for (const email of [unverified, verified]) {
        const state = (await authState(email))!;
        expect(state).not.toBeNull();
        expect((await accountRows(state.authUserId))!.profiles).toHaveLength(1);
      }
    });

    it("GitHub (rows as the component writes them, simulated)", async () => {
      const email = syntheticEmail("survive-github");
      const authUserId = await adminClient().mutation(simulateGithubSignUp, { email, githubId: `${Date.now()}` });
      expect((await accountRows(authUserId))!.profiles).toHaveLength(1);
      await repairHalfFinishedSignUps(window());
      expect(await authState(email)).not.toBeNull();
      expect((await accountRows(authUserId))!.profiles).toHaveLength(1);
    });
  });
});
