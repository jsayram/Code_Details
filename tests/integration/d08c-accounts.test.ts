// D08c: what a Better Auth sign-up creates in the app, on the task-owned local
// backend with synthetic users. Profile and handle in the same transaction as
// the auth user; provider name/avatar copied once and never again; half-
// finished sign-ups repaired; switching accounts in one browser.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clearConvexFixtures, convexAvailable } from "../fixtures/convex";
import {
  SYNTHETIC_PASSWORD,
  accountRows,
  authFetch,
  authState,
  clientWithToken,
  convexToken,
  repairHalfFinishedSignUps,
  setAccountStatus,
  signIn,
  signOut,
  signUp,
  stripCredentials,
  syntheticEmail,
  type Jar,
} from "../fixtures/better-auth";

// TEST-D08C-TIMEOUT: each test signs up through Better Auth and the local
// backend; under heavy machine load that outruns vitest's 5 s default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const whoami = makeFunctionReference<"query">("identity:whoami");
const HANDLE = /^user-[0-9a-z]{6}$/;

async function me(jar: Jar) {
  const token = await convexToken(jar);
  return token ? clientWithToken(token).query(whoami, {}) : null;
}

async function signedUp(label: string, name = "Synthetic Person", extra: { image?: string } = {}) {
  const email = syntheticEmail(label);
  const res = await signUp(email, SYNTHETIC_PASSWORD, name, extra);
  expect(res.status).toBe(200);
  const state = (await authState(email))!;
  const rows = (await accountRows(state.authUserId))!;
  return { email, jar: res.jar, state, rows };
}

/** A repair window that includes sign-ups made just now. */
const now = () => ({ createdBefore: Date.now() + 1000, createdAfter: Date.now() - 60 * 60 * 1000 });

describe.skipIf(!convexAvailable())("D08c account rows at sign-up", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
  });

  afterAll(async () => {
    await clearConvexFixtures();
  });

  describe("profile and handle", () => {
    it("sign-up creates one profile with a generated handle and a current username claim", async () => {
      const { rows, jar } = await signedUp("profile");
      expect(rows.profiles).toHaveLength(1);
      const [profile] = rows.profiles;
      expect(profile.username).toMatch(HANDLE);
      expect(profile.usernameKey).toBe(profile.username);
      expect(rows.usernames).toEqual([expect.objectContaining({ usernameKey: profile.usernameKey, state: "current" })]);
      expect(await me(jar)).toEqual({ username: profile.username, role: "user", tier: "free" });
    });

    it("handles are unique across sign-ups", async () => {
      const made = await Promise.all(Array.from({ length: 8 }, (_, i) => signedUp(`unique${i}`)));
      const handles = made.map((m) => m.rows.profiles[0].username);
      expect(new Set(handles).size).toBe(handles.length);
    });
  });

  describe("seeded once from the provider (P07 §5.4)", () => {
    it("copies the name as fullName, no first/last split", async () => {
      const { rows } = await signedUp("name", "  Ada   Lovelace ");
      expect(rows.profiles[0]).toMatchObject({ fullName: "Ada Lovelace" });
      expect(rows.profiles[0].firstName).toBeUndefined();
      expect(rows.profiles[0].lastName).toBeUndefined();
    });

    it("never turns an address into a public name", async () => {
      const email = syntheticEmail("emailname");
      expect((await signUp(email, SYNTHETIC_PASSWORD, email)).status).toBe(200);
      const rows = (await accountRows((await authState(email))!.authUserId))!;
      expect(rows.profiles[0].fullName).toBeUndefined();
      const other = await signedUp("atname", "someone@elsewhere.invalid");
      expect(other.rows.profiles[0].fullName).toBeUndefined();
    });

    it("keeps an allowed https avatar and drops any other", async () => {
      const ok = await signedUp("avatar", "Synthetic Person", { image: "https://avatars.githubusercontent.com/u/1?v=4" });
      expect(ok.rows.profiles[0].avatar).toEqual({ kind: "external", url: "https://avatars.githubusercontent.com/u/1?v=4" });
      for (const image of ["https://evil.synthetic.invalid/a.png", "http://avatars.githubusercontent.com/u/1"]) {
        const bad = await signedUp("badavatar", "Synthetic Person", { image });
        expect(bad.rows.profiles[0].avatar).toBeUndefined();
      }
    });

    it("later provider changes (update-user) don't reach the profile", async () => {
      const { jar, state, rows } = await signedUp("update", "First Name");
      const res = await authFetch("/update-user", { body: { name: "Changed Name", image: "https://avatars.githubusercontent.com/u/2" }, jar });
      expect(res.status).toBe(200);
      const after = (await accountRows(state.authUserId))!;
      expect(after.profiles).toEqual(rows.profiles);
      expect(after.profiles[0].fullName).toBe("First Name");
      expect(after.profiles[0].avatar).toBeUndefined();
    });
  });

  describe("half-finished sign-ups", () => {
    it("an auth user left without credentials blocks its address until repaired", async () => {
      const { email, state } = await signedUp("halfway");
      await stripCredentials(state.authUserId);
      expect((await signIn(email, SYNTHETIC_PASSWORD)).status).toBe(401);
      expect((await signUp(email, SYNTHETIC_PASSWORD)).status).toBeGreaterThanOrEqual(400);

      const result = await repairHalfFinishedSignUps(now());
      expect(result.removed).toBeGreaterThanOrEqual(1);
      expect(await authState(email)).toBeNull();
      expect(await accountRows(state.authUserId)).toBeNull();

      const retry = await signUp(email, SYNTHETIC_PASSWORD);
      expect(retry.status).toBe(200);
      const fresh = (await authState(email))!;
      expect(fresh.authUserId).not.toBe(state.authUserId);
      expect(fresh.users).toHaveLength(1);
      expect(await me(retry.jar)).toMatchObject({ role: "user", tier: "free" });
    });

    it("leaves complete sign-ups and accounts that hold more than sign-up made", async () => {
      const complete = await signedUp("complete");
      const busy = await signedUp("busy");
      await stripCredentials(busy.state.authUserId);
      await setAccountStatus(busy.state.authUserId, "deleting");
      const result = await repairHalfFinishedSignUps(now());
      expect(result.kept).toBeGreaterThanOrEqual(1);
      expect(await authState(complete.email)).not.toBeNull();
      expect((await accountRows(complete.state.authUserId))!.profiles).toHaveLength(1);
      expect(await authState(busy.email)).not.toBeNull();
      expect(await accountRows(busy.state.authUserId)).not.toBeNull();
    });

    it("by default only looks at sign-ups between 1 and 25 hours old", async () => {
      const { email, state } = await signedUp("tooyoung");
      await stripCredentials(state.authUserId);
      await repairHalfFinishedSignUps({});
      expect(await authState(email)).not.toBeNull();
    });
  });

  describe("switching accounts in one browser", () => {
    it("A, sign out, B: the same cookie jar resolves to B", async () => {
      const a = await signedUp("switch-a");
      const b = await signedUp("switch-b");
      let jar = (await signIn(a.email, SYNTHETIC_PASSWORD)).jar;
      expect(await me(jar)).toMatchObject({ username: a.rows.profiles[0].username });
      jar = (await signOut(jar)).jar;
      expect(await me(jar)).toBeNull();
      jar = (await signIn(b.email, SYNTHETIC_PASSWORD, jar)).jar;
      expect(await me(jar)).toMatchObject({ username: b.rows.profiles[0].username });
    });

    it("signing in as B over A's session replaces it in that browser", async () => {
      const a = await signedUp("over-a");
      const b = await signedUp("over-b");
      const jarA = (await signIn(a.email, SYNTHETIC_PASSWORD)).jar;
      const jarB = (await signIn(b.email, SYNTHETIC_PASSWORD, jarA)).jar;
      expect(await me(jarB)).toMatchObject({ username: b.rows.profiles[0].username });
      expect(jarB.get("better-auth.session_token")).not.toBe(jarA.get("better-auth.session_token"));
    });

    it("two sessions of one user are independent: signing out one leaves the other", async () => {
      const { email, rows } = await signedUp("two");
      const one = (await signIn(email, SYNTHETIC_PASSWORD)).jar;
      const two = (await signIn(email, SYNTHETIC_PASSWORD)).jar;
      await signOut(one);
      expect(await me(one)).toBeNull();
      expect(await me(two)).toMatchObject({ username: rows.profiles[0].username });
    });
  });
});
