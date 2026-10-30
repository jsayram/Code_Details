// D04b (P08 R22, R05): the owner's profile edit on the default Supabase path.
// Identity from the session only; ASCII username rules; the rename and its
// username_history row in one transaction; a released name stays reserved for
// its user for 90 days; the admin rename follows the same rules.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const { a: A, b: B, renamed, emailUsername: legacy } = set.personas;
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!testDbAvailable())("D04b profile edit (Supabase)", () => {
  let sql: postgres.Sql;
  let route: typeof import("../../src/app/api/profiles/[username]/route.js");

  const put = (urlName: string, body: unknown) =>
    route.PUT(
      new NextRequest(new URL(`/api/profiles/${encodeURIComponent(urlName)}`, "http://localhost:3100"), { method: "PUT", body: JSON.stringify(body) }),
      { params: Promise.resolve({ username: urlName }) },
    );
  const usernameOf = async (subject: string) => (await sql`select username from profiles where user_id = ${subject}`)[0]?.username;
  const history = async (subject: string) =>
    (await sql`select old_username, new_username from username_history where user_id = ${subject} order by old_username`).map((r) => ({ ...r }));
  const addHistory = (old: string, subject: string, ageDays: number) =>
    sql`insert into username_history (old_username, user_id, new_username, changed_at)
        values (${old}, ${subject}, 'whatever', ${new Date(Date.now() - ageDays * DAY)})`;

  beforeAll(async () => {
    sql = await connectTestDb();
    route = await import("../../src/app/api/profiles/[username]/route.js");
  });
  beforeEach(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  describe("who may edit", () => {
    it("signed out: 401, nothing written", async () => {
      expect((await put(A.profile!.username, { full_name: "X" })).status).toBe(401);
      expect((await sql`select full_name from profiles where user_id = ${A.subject}`)[0].full_name).toBe("Alice Fixture");
    });

    it("someone else's profile: 403, nothing written", async () => {
      signInAs(B.subject);
      expect((await put(A.profile!.username, { username: "fixture-hijack", full_name: "X" })).status).toBe(403);
      expect(await usernameOf(A.subject!)).toBe("fixture-alice");
      expect(await history(A.subject!)).toEqual([]);
    });

    it("the owner, with the URL in any casing: 200, public fields in the answer", async () => {
      signInAs(A.subject);
      const res = await put("FIXTURE-ALICE", { full_name: "Alice Renamed" });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text).data.profile).toMatchObject({ username: "fixture-alice", full_name: "Alice Renamed" });
      expect(text).not.toContain(A.profile!.email);
      expect(text).not.toContain(A.subject!);
      expect(text).not.toMatch(/"tier"|"user_id"|"email_address"/);
    });
  });

  describe("rename", () => {
    it("writes the profile and the history row", async () => {
      signInAs(A.subject);
      expect((await put("fixture-alice", { username: "Fixture-Alicia" })).status).toBe(200);
      expect(await usernameOf(A.subject!)).toBe("Fixture-Alicia");
      expect(await history(A.subject!)).toEqual([{ old_username: "fixture-alice", new_username: "Fixture-Alicia" }]);
    });

    it("a change of case only is not a rename: no history row", async () => {
      signInAs(A.subject);
      expect((await put("fixture-alice", { username: "Fixture-ALICE" })).status).toBe(200);
      expect(await usernameOf(A.subject!)).toBe("Fixture-ALICE");
      expect(await history(A.subject!)).toEqual([]);
    });

    it.each(["ab", "_alice", "alice!", "ádmin", "admin", "x".repeat(31)])("refuses %j with 400, nothing written", async (name) => {
      signInAs(A.subject);
      const res = await put("fixture-alice", { username: name });
      expect(res.status).toBe(400);
      expect(await usernameOf(A.subject!)).toBe("fixture-alice");
      expect(await history(A.subject!)).toEqual([]);
    });

    it("someone else's name, in any casing, is taken (409)", async () => {
      signInAs(A.subject);
      const res = await put("fixture-alice", { username: "FIXTURE-BOB" });
      expect(res.status).toBe(409);
      expect(await usernameOf(A.subject!)).toBe("fixture-alice");
    });

    it("a name another user released under 90 days ago is taken; an older one is free and its history goes", async () => {
      await addHistory("fixture-recent-old", renamed.subject!, 10);
      await addHistory("fixture-stale-old", renamed.subject!, 100);
      signInAs(A.subject);
      expect((await put("fixture-alice", { username: "fixture-recent-old" })).status).toBe(409);
      expect((await put("fixture-alice", { username: "fixture-stale-old" })).status).toBe(200);
      expect((await history(renamed.subject!)).map((r) => r.old_username)).not.toContain("fixture-stale-old");
    });

    it("the owner can take their own reserved name back; its old history row goes", async () => {
      signInAs(A.subject);
      await put("fixture-alice", { username: "fixture-alicia" });
      expect((await put("fixture-alicia", { username: "fixture-alice" })).status).toBe(200);
      expect(await usernameOf(A.subject!)).toBe("fixture-alice");
      expect(await history(A.subject!)).toEqual([{ old_username: "fixture-alicia", new_username: "fixture-alice" }]);
    });

    it("two people claiming one name at once: exactly one gets it", async () => {
      const claim = async (subject: string, from: string) => {
        signInAs(subject);
        return put(from, { username: "fixture-contested" });
      };
      // signInAs is global; run the two handlers interleaved with each one's
      // session captured before its first await.
      const [ra, rb] = await Promise.all([claim(A.subject!, "fixture-alice"), claim(B.subject!, "fixture-bob")]);
      const statuses = [ra.status, rb.status].sort();
      const holders = await sql`select user_id from profiles where lower(username) = 'fixture-contested'`;
      expect(holders).toHaveLength(1);
      expect(statuses).toContain(200);
    });

    it("a legacy email-shaped name renames without a history row (the address never becomes a redirect)", async () => {
      signInAs(legacy.subject);
      expect((await put(legacy.profile!.username, { username: "fixture-legacy-new" })).status).toBe(200);
      expect(await history(legacy.subject!)).toEqual([]);
      expect((await sql`select 1 from username_history where old_username like '%@%'`).length).toBe(0);
    });

    it("the old name redirects to the new one", async () => {
      signInAs(A.subject);
      await put("fixture-alice", { username: "fixture-alicia" });
      const res = await route.GET(new NextRequest(new URL("/api/profiles/fixture-alice", "http://localhost:3100")), { params: Promise.resolve({ username: "fixture-alice" }) });
      expect(JSON.parse(await res.text()).data).toMatchObject({ redirect: true, currentUsername: "fixture-alicia" });
    });
  });

  describe("admin rename (updateUserProfile)", () => {
    it("follows the rules and writes history", async () => {
      const { updateUserProfile } = await import("../../src/db/operations/userManagementOperations.js");
      await expect(updateUserProfile(B.profile!.id, { username: "x!" })).rejects.toThrow(/letters, numbers/);
      await expect(updateUserProfile(B.profile!.id, { username: "fixture-alice" })).rejects.toThrow(/taken/);
      const updated = await updateUserProfile(B.profile!.id, { username: "fixture-roberto" });
      expect(updated.username).toBe("fixture-roberto");
      expect(await history(B.subject!)).toEqual([{ old_username: "fixture-bob", new_username: "fixture-roberto" }]);
    });
  });
});
