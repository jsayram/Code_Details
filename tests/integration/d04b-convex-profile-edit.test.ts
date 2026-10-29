// D04b: profiles:updateMine on the task-owned test backend. The caller comes
// only from getViewer (the D01 synthetic issuer for Clerk-era personas). Every
// refusal is checked to have written nothing.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";

type Patch = { handle?: string; fullName?: string | null; firstName?: string | null; lastName?: string | null; avatarUrl?: string | null };
type Result = { ok: boolean; code?: string; field?: string; message?: string; profile?: Record<string, unknown> };
type State = {
  profile: { username: string; usernameKey: string; fullName: string | null; avatar: unknown };
  usernames: { usernameKey: string; state: string; reservedUntil: number | null }[];
  audit: { kind: string; actorId: string | null; details: Record<string, unknown> | null }[];
  outbox: { change: string }[];
} | null;

const updateMine = makeFunctionReference<"mutation", { currentHandle: string; patch: Patch }, Result>("profiles:updateMine");
const getPublicByUsername = makeFunctionReference<"query", { handle: string }>("profiles:getPublicByUsername");
const addUsernameClaim = makeFunctionReference<"mutation">("fixtures:addUsernameClaim");
const profileWriteState = makeFunctionReference<"query", { userUsernameKey: string }, State>("fixtures:profileWriteState");
const state = (key: string) => adminClient().query(profileWriteState, { userUsernameKey: key });

const set = generateFixtures();
const { a: A, b: B, deleting } = set.personas;
const DAY = 24 * 60 * 60 * 1000;
const asA = () => clientAs(A.subject!);
const edit = (client: ReturnType<typeof anonymousClient>, currentHandle: string, patch: Patch) => client.mutation(updateMine, { currentHandle, patch });

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D04b Convex profile edit", () => {
  beforeEach(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
    // Fixture loads write no claims; give A and B their current rows as sign-up would.
    const admin = adminClient();
    for (const key of ["fixture-alice", "fixture-bob"]) {
      await admin.mutation(addUsernameClaim, { holderUsernameKey: key, usernameKey: key, state: "current" });
    }
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  describe("who may edit", () => {
    it("anonymous: not_signed_in, nothing written", async () => {
      expect(await edit(anonymousClient(), "fixture-alice", { fullName: "X" })).toEqual({ ok: false, code: "not_signed_in" });
      expect((await state("fixture-alice"))!.profile.fullName).toBe("Alice Fixture");
    });

    it("a deleting account: not_signed_in", async () => {
      expect((await edit(clientAs(deleting.subject!), "fixture-leaving", { fullName: "X" })).code).toBe("not_signed_in");
    });

    it("another user's handle: not_found, nothing written", async () => {
      expect(await edit(clientAs(B.subject!), "fixture-alice", { handle: "fixture-hijack" })).toEqual({ ok: false, code: "not_found" });
      expect((await state("fixture-alice"))!.profile.username).toBe("fixture-alice");
    });
  });

  describe("fields", () => {
    it("names are cleaned and can be cleared; an address is refused", async () => {
      const r = await edit(asA(), "FIXTURE-alice", { fullName: "  Alice ​  Renamed ", lastName: null });
      expect(r).toMatchObject({ ok: true, profile: { username: "fixture-alice", fullName: "Alice Renamed" } });
      expect(Object.keys(r.profile!).sort()).toEqual(["avatarUrl", "createdAt", "fullName", "updatedAt", "username"]);
      expect(await edit(asA(), "fixture-alice", { fullName: "me@example.com" })).toMatchObject({ ok: false, code: "invalid", field: "fullName" });
      expect(await edit(asA(), "fixture-alice", { fullName: null })).toMatchObject({ ok: true, profile: { fullName: null } });
    });

    it("avatars: allow-listed https hosts only, or cleared", async () => {
      expect(await edit(asA(), "fixture-alice", { avatarUrl: "https://avatars.githubusercontent.com/u/1" })).toMatchObject({ ok: true, profile: { avatarUrl: "https://avatars.githubusercontent.com/u/1" } });
      for (const bad of ["http://avatars.githubusercontent.com/u/1", "https://evil.example/x.png", "javascript:alert(1)"]) {
        expect(await edit(asA(), "fixture-alice", { avatarUrl: bad }), bad).toMatchObject({ ok: false, code: "invalid", field: "avatarUrl" });
      }
      expect(await edit(asA(), "fixture-alice", { avatarUrl: null })).toMatchObject({ ok: true, profile: { avatarUrl: null } });
    });
  });

  describe("rename", () => {
    it("profile, previous row with a 90-day reservation, new current row, audit and outbox in one mutation", async () => {
      const before = Date.now();
      const r = await edit(asA(), "fixture-alice", { handle: "Fixture-Alicia" });
      expect(r).toMatchObject({ ok: true, profile: { username: "Fixture-Alicia" } });
      const s = (await state("fixture-alicia"))!;
      expect(s.profile).toMatchObject({ username: "Fixture-Alicia", usernameKey: "fixture-alicia" });
      const prev = s.usernames.find((u) => u.usernameKey === "fixture-alice")!;
      expect(prev.state).toBe("previous");
      expect(prev.reservedUntil! - before).toBeGreaterThanOrEqual(90 * DAY - 60_000);
      expect(prev.reservedUntil! - before).toBeLessThanOrEqual(90 * DAY + 60_000);
      expect(s.usernames.filter((u) => u.state === "current")).toEqual([{ usernameKey: "fixture-alicia", state: "current", reservedUntil: null }]);
      expect(s.audit).toEqual([expect.objectContaining({ kind: "username.changed", details: { from: "fixture-alice", to: "fixture-alicia" } })]);
      expect(s.outbox.length).toBeGreaterThan(0);
      expect(await anonymousClient().query(getPublicByUsername, { handle: "fixture-alice" })).toEqual({ kind: "redirect", currentUsername: "Fixture-Alicia" });
    });

    it.each(["ab", "_alice", "alice!", "ádmin", "admin", "x".repeat(31)])("refuses %j, nothing written", async (name) => {
      expect(await edit(asA(), "fixture-alice", { handle: name })).toMatchObject({ ok: false, code: "invalid", field: "username" });
      const s = (await state("fixture-alice"))!;
      expect(s.audit).toEqual([]);
      expect(s.usernames).toEqual([{ usernameKey: "fixture-alice", state: "current", reservedUntil: null }]);
    });

    it("someone else's name in any casing, or their live reservation, is taken; an expired one is free", async () => {
      expect(await edit(asA(), "fixture-alice", { handle: "FIXTURE-BOB" })).toMatchObject({ ok: false, code: "taken" });
      const admin = adminClient();
      await admin.mutation(addUsernameClaim, { holderUsernameKey: "fixture-bob", usernameKey: "fixture-bobby", state: "previous", reservedUntil: Date.now() + 30 * DAY });
      await admin.mutation(addUsernameClaim, { holderUsernameKey: "fixture-bob", usernameKey: "fixture-robert", state: "previous", reservedUntil: Date.now() - DAY });
      expect(await edit(asA(), "fixture-alice", { handle: "fixture-bobby" })).toMatchObject({ ok: false, code: "taken" });
      expect(await edit(asA(), "fixture-alice", { handle: "fixture-robert" })).toMatchObject({ ok: true });
      expect((await state("fixture-bob"))!.usernames.map((u) => u.usernameKey)).not.toContain("fixture-robert");
    });

    it("the owner takes their own reserved name back: one current row, no leftover reservation for it", async () => {
      await edit(asA(), "fixture-alice", { handle: "fixture-alicia" });
      expect(await edit(asA(), "fixture-alicia", { handle: "fixture-alice" })).toMatchObject({ ok: true });
      const s = (await state("fixture-alice"))!;
      expect(s.usernames.filter((u) => u.usernameKey === "fixture-alice")).toEqual([{ usernameKey: "fixture-alice", state: "current", reservedUntil: null }]);
      expect(s.usernames.find((u) => u.usernameKey === "fixture-alicia")?.state).toBe("previous");
    });

    it("a change of case only: no claim rows change, no audit row", async () => {
      expect(await edit(asA(), "fixture-alice", { handle: "Fixture-ALICE" })).toMatchObject({ ok: true, profile: { username: "Fixture-ALICE" } });
      const s = (await state("fixture-alice"))!;
      expect(s.audit).toEqual([]);
      expect(s.usernames).toEqual([{ usernameKey: "fixture-alice", state: "current", reservedUntil: null }]);
    });
  });
});
