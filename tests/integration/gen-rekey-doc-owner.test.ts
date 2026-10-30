// Generator re-key: identity:docOwner gives the caller its own account ID (the
// key new generated docs carry) and its own Clerk-era subject while that link
// exists, and nothing for anyone getViewer refuses. Real test backend; personas
// are the D01 fixtures, Better Auth logins are real sign-ups linked to a
// persona with fixtures:linkPersona.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, authState, clientWithToken, convexToken, linkPersona, signIn, signOut, signUp, syntheticEmail } from "../fixtures/better-auth";
import { TEST_CONVEX_URL } from "../support/isolation";

type DocOwner = { userId: string; legacySubject: string | null } | null;
const docOwner = makeFunctionReference<"query", Record<string, never>, DocOwner>("identity:docOwner");
const clerkSubjectMap = makeFunctionReference<"query", Record<string, never>, Record<string, string>>("identity:clerkSubjectMap");
const set = generateFixtures();
const { a: A, b: B } = set.personas;

async function login(label: string) {
  const email = syntheticEmail(label);
  const res = await signUp(email, SYNTHETIC_PASSWORD);
  expect(res.status).toBe(200);
  return { email, jar: res.jar, token: (await convexToken(res.jar))!, authUserId: (await authState(email))!.authUserId };
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("generator re-key identity:docOwner", () => {
  beforeEach(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("an account with no Clerk-era link gets its own account ID and no legacy subject, the same on every sign-in", async () => {
    const fresh = await login("genrekey-fresh");
    const first = await clientWithToken(fresh.token).query(docOwner, {});
    expect(first).not.toBeNull();
    expect(first!.legacySubject).toBeNull();
    expect(typeof first!.userId).toBe("string");
    expect(first!.userId).not.toMatch(/^user_/);
    expect(first!.userId).not.toBe(fresh.authUserId);
    const again = await signIn(fresh.email, SYNTHETIC_PASSWORD);
    expect(await clientWithToken((await convexToken(again.jar))!).query(docOwner, {})).toEqual(first);
  });

  it("a linked Better Auth login gets its persona's account ID and Clerk-era subject; A never gets B's", async () => {
    const a = await login("genrekey-a");
    const b = await login("genrekey-b");
    await linkPersona(A.subject!, a.authUserId);
    await linkPersona(B.subject!, b.authUserId);
    const ownerA = await clientWithToken(a.token).query(docOwner, {});
    const ownerB = await clientWithToken(b.token).query(docOwner, {});
    expect(ownerA?.legacySubject).toBe(A.subject);
    expect(ownerB?.legacySubject).toBe(B.subject);
    expect(ownerA!.userId).not.toBe(ownerB!.userId);
    // The same account as the Clerk-era persona's own token resolves to.
    expect(await clientAs(A.subject!).query(docOwner, {})).toEqual(ownerA);
  });

  it("two accounts with no Clerk-era link get different account IDs", async () => {
    const one = await login("genrekey-one");
    const two = await login("genrekey-two");
    const o1 = await clientWithToken(one.token).query(docOwner, {});
    const o2 = await clientWithToken(two.token).query(docOwner, {});
    expect(o1!.userId).not.toBe(o2!.userId);
  });

  it("anonymous callers get null", async () => {
    expect(await new ConvexHttpClient(TEST_CONVEX_URL).query(docOwner, {})).toBeNull();
  });

  it("a signed-out session's token gets null", async () => {
    const fresh = await login("genrekey-signed-out");
    expect(await clientWithToken(fresh.token).query(docOwner, {})).not.toBeNull();
    await signOut(fresh.jar);
    expect(await clientWithToken(fresh.token).query(docOwner, {})).toBeNull();
  });

  it("a deleting account gets null", async () => {
    expect(await clientAs(set.personas.deleting.subject!).query(docOwner, {})).toBeNull();
  });

  it("slice 3: the re-key mapping maps each Clerk-era subject to the account docOwner reports, and only an admin can read it", async () => {
    const a = await login("genrekey-map-a");
    await linkPersona(A.subject!, a.authUserId);
    const map = await adminClient().query(clerkSubjectMap, {});
    expect(map[A.subject!]).toBe((await clientWithToken(a.token).query(docOwner, {}))!.userId);
    expect(map[B.subject!]).toBe((await clientAs(B.subject!).query(docOwner, {}))!.userId);
    // Only Clerk-era subjects, never a Better Auth user ID
    expect(Object.keys(map)).not.toContain(a.authUserId);
    expect(Object.keys(map).every((k) => k.startsWith("user_"))).toBe(true);
    // Internal: no client can call it, signed in or not
    await expect(new ConvexHttpClient(TEST_CONVEX_URL).query(clerkSubjectMap, {})).rejects.toThrow();
    await expect(clientWithToken(a.token).query(clerkSubjectMap, {})).rejects.toThrow();
  });
});
