// Generator re-key: identity:docOwner gives the caller its own account ID (the
// key new generated docs carry) and its own Clerk-era subject while that link
// exists, and nothing for anyone getViewer refuses. Real test backend; personas
// are the D01 fixtures, Better Auth logins are real sign-ups linked to a
// persona with fixtures:linkPersona.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs } from "../fixtures/convex-auth";
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

describe.skipIf(!convexAvailable())("generator re-key identity:docOwner", () => {
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

  it("slice 3: a hand-written one-entry map with a real account ID re-keys a doc through the tool", async () => {
    // As Jose would for his own docs: old Clerk subject -> the account ID of his new Better Auth login
    const fresh = await login("genrekey-handmap");
    const accountId = (await clientWithToken(fresh.token).query(docOwner, {}))!.userId;
    const work = path.resolve(__dirname, "../../.test-runtime", `rekey-handmap-${process.pid}`);
    const root = path.resolve(__dirname, "../../.test-runtime/docs-output", `rekey-handmap-${process.pid}`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    try {
      fs.mkdirSync(path.join(root, "handmap-doc"), { recursive: true });
      fs.mkdirSync(work, { recursive: true });
      fs.writeFileSync(path.join(root, "handmap-doc", "_meta.json"), JSON.stringify({ projectSlug: "handmap-doc", userId: "user_fixture_handmap_old", repoName: "x" }, null, 2));
      fs.writeFileSync(path.join(work, "map.json"), `{ "user_fixture_handmap_old": "${accountId}" }\n`);
      const script = path.resolve(__dirname, "../../scripts/docs-rekey.mjs");
      const res = spawnSync(process.execPath, [script, "--root", root, "--map", path.join(work, "map.json"), "--apply", "--backup", path.join(work, "backup")], { encoding: "utf8" });
      expect(res.status, res.stdout + res.stderr).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(root, "handmap-doc", "_meta.json"), "utf8"))).toMatchObject({ userId: accountId, legacyUserId: "user_fixture_handmap_old" });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
