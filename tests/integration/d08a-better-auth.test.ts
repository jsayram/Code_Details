// D08a: Better Auth on the task-owned local Convex backend, credential-free.
// Synthetic users sign up, sign in and out over the component's HTTP routes
// (127.0.0.1:3211); the Convex token they get resolves through getViewer's
// session-validating path to the app account the sign-up created. The point
// of the session check: a token that is still cryptographically valid stops
// working the moment its session is signed out, revoked or expired.
//
// This proves the Convex side only. The Next.js route, cookies on the app
// origin, refresh and real providers are later slices (D08_PLAN.md).
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";
import {
  SITE_ORIGIN,
  SYNTHETIC_PASSWORD,
  appTablesText,
  authFetch,
  authState,
  claims,
  clientWithToken,
  convexToken,
  expireSession,
  setAccountStatus,
  signIn,
  signOut,
  signUp,
  syntheticEmail,
  type Jar,
} from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";

const whoami = makeFunctionReference<"query">("identity:whoami");
const NEW_ACCOUNT = { username: null, role: "user", tier: "free" };

async function signedUp(label: string) {
  const email = syntheticEmail(label);
  const res = await signUp(email, SYNTHETIC_PASSWORD);
  expect(res.status).toBe(200);
  const state = (await authState(email))!;
  return { email, jar: res.jar, state };
}

async function whoamiFor(jar: Jar) {
  const token = await convexToken(jar);
  expect(token).toBeTruthy();
  return { token: token!, me: await clientWithToken(token!).query(whoami, {}) };
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D08a Better Auth on Convex", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    // The Clerk-era personas stay loaded, so the two paths are tested side by side.
    await loadConvexFixtures(generateFixtures());
  });

  afterAll(async () => {
    await clearConvexFixtures();
  });

  describe("sign-up", () => {
    it("creates exactly one app account and one better-auth link, nothing more", async () => {
      const { state } = await signedUp("signup");
      expect(state.users).toHaveLength(1);
      expect(state.users[0]).toMatchObject({ authUserId: state.authUserId, role: "user", tier: "free", status: "active" });
      expect(state.links).toEqual([expect.objectContaining({ userId: state.users[0]._id, provider: "better-auth", subject: state.authUserId })]);
    });

    it("copies no email or name into any app table (P07 §5.5)", async () => {
      const { email } = await signedUp("noemail");
      const text = await appTablesText();
      expect(text).not.toContain(email);
      expect(text).not.toContain("@synthetic.invalid");
      expect(text).not.toContain("Synthetic Person");
    });

    it("refuses a second sign-up with the same email and keeps one account", async () => {
      const { email, state } = await signedUp("twice");
      const again = await signUp(email, SYNTHETIC_PASSWORD);
      expect(again.status).toBeGreaterThanOrEqual(400);
      const after = (await authState(email))!;
      expect(after.authUserId).toBe(state.authUserId);
      expect(after.users).toHaveLength(1);
      expect(after.links).toHaveLength(1);
    });

    it("sets the session cookie HttpOnly and SameSite=Lax", async () => {
      const res = await signUp(syntheticEmail("cookie"), SYNTHETIC_PASSWORD);
      const session = res.setCookies.find((c) => c.startsWith("better-auth.session_token="));
      expect(session).toBeDefined();
      expect(session).toMatch(/;\s*HttpOnly/i);
      expect(session).toMatch(/;\s*SameSite=Lax/i);
    });
  });

  describe("sign-in resolves through getViewer", () => {
    it("the session's Convex token resolves to the account the sign-up created", async () => {
      const { email } = await signedUp("signin");
      const res = await signIn(email, SYNTHETIC_PASSWORD);
      expect(res.status).toBe(200);
      const { me } = await whoamiFor(res.jar);
      expect(me).toEqual(NEW_ACCOUNT);
    });

    it("the token carries the auth user ID and session ID, no email or name", async () => {
      const { jar, state } = await signedUp("claims");
      const { token } = await whoamiFor(jar);
      const c = claims(token);
      expect(c).toMatchObject({ iss: TEST_CONVEX_SITE_URL, aud: "convex", sub: state.authUserId });
      expect(state.sessionIds).toContain(c.sessionId);
      expect(Object.keys(c).sort()).toEqual(["aud", "exp", "iat", "iss", "sessionId", "sub"]);
      expect(JSON.stringify(c)).not.toContain("@synthetic.invalid");
    });

    it("a wrong password or an unknown user gets no session", async () => {
      const { email } = await signedUp("wrongpw");
      for (const res of [await signIn(email, "not-the-password-1"), await signIn(syntheticEmail("nobody"), SYNTHETIC_PASSWORD)]) {
        expect(res.status).toBe(401);
        expect(res.jar.has("better-auth.session_token")).toBe(false);
      }
    });

    it("anonymous is still null", async () => {
      expect(await anonymousClient().query(whoami, {})).toBeNull();
    });
  });

  describe("a still-valid token stops working when its session ends", () => {
    it("sign-out: the earlier token is null and no new token is issued", async () => {
      const { jar } = await signedUp("signout");
      const { token, me } = await whoamiFor(jar);
      expect(me).toEqual(NEW_ACCOUNT);
      const out = await signOut(jar);
      expect(out.status).toBe(200);
      expect((claims(token).exp as number) * 1000).toBeGreaterThan(Date.now());
      expect(await clientWithToken(token).query(whoami, {})).toBeNull();
      expect(await convexToken(jar)).toBeNull();
      expect(await convexToken(out.jar)).toBeNull();
    });

    it("expiry: once the session is past its expiresAt, the token is null", async () => {
      const { jar } = await signedUp("expiry");
      const { token } = await whoamiFor(jar);
      await expireSession(claims(token).sessionId as string);
      expect(await clientWithToken(token).query(whoami, {})).toBeNull();
    });

    it("revocation: revoking one session leaves the user's other session working", async () => {
      const { email } = await signedUp("revoke");
      const first = await signIn(email, SYNTHETIC_PASSWORD);
      const second = await signIn(email, SYNTHETIC_PASSWORD);
      const firstToken = (await whoamiFor(first.jar)).token;
      const secondToken = (await whoamiFor(second.jar)).token;
      const listed = await authFetch("/list-sessions", { method: "GET", jar: first.jar });
      const target = (listed.body as { id: string; token: string }[]).find((s) => s.id === claims(secondToken).sessionId)!;
      expect(target).toBeDefined();
      const revoked = await authFetch("/revoke-session", { body: { token: target.token }, jar: first.jar });
      expect(revoked.status).toBe(200);
      expect(await clientWithToken(secondToken).query(whoami, {})).toBeNull();
      expect(await clientWithToken(firstToken).query(whoami, {})).toEqual(NEW_ACCOUNT);
    });
  });

  describe("denials", () => {
    it("an account in its deletion grace period is null, and resolves again when restored", async () => {
      const { jar, state } = await signedUp("deleting");
      const { token } = await whoamiFor(jar);
      await setAccountStatus(state.authUserId, "deleting");
      expect(await clientWithToken(token).query(whoami, {})).toBeNull();
      await setAccountStatus(state.authUserId, "active");
      expect(await clientWithToken(token).query(whoami, {})).toEqual(NEW_ACCOUNT);
    });

    it("another trusted issuer can't borrow a Better Auth session by naming it in its claims", async () => {
      const { jar, state } = await signedUp("forged");
      const { token } = await whoamiFor(jar);
      const sessionId = claims(token).sessionId;
      // The Clerk-era synthetic issuer is trusted by Convex, but its tokens
      // only resolve through clerk links; a better-auth subject has none.
      expect(await clientAs(state.authUserId, { extraClaims: { sessionId } }).query(whoami, {})).toBeNull();
    });

    it("a cookie-carrying request from a foreign origin is refused (CSRF)", async () => {
      const { email, jar } = await signedUp("origin");
      const res = await authFetch("/sign-in/email", { body: { email, password: SYNTHETIC_PASSWORD }, jar, origin: "http://evil.synthetic.invalid" });
      expect(res.status).toBe(403);
      // The same call from the site origin is fine.
      expect((await authFetch("/sign-in/email", { body: { email, password: SYNTHETIC_PASSWORD }, jar, origin: SITE_ORIGIN })).status).toBe(200);
    });
  });
});
