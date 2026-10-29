// D04d (P07 §5.7, §5.11; P08 R24): account deletion on the task-owned test
// backend with synthetic fixtures only. Request hides the account and signs it
// out; cancel inside the 14 days puts everything back; after the date the
// batched purge removes what the account owned through the normal purge path
// and leaves a tombstone. The purge flag is set on this test backend only.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, getPublicBySlug, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, accountRows, authState, clientWithToken, convexToken, signIn, signUp, syntheticEmail, verifyEmail } from "../fixtures/better-auth";
import { ACCOUNT_DELETION_GRACE_MS, ACCOUNT_PROJECTS_PER_STEP } from "@/backend/profiles/account-deletion-rules";

type Residue = {
  user: Record<string, unknown> | null;
  projects: number;
  listedProjects: number;
  favorites: number;
  suggestions: string[];
  usernames: number;
  profiles: number;
  authLinks: number;
  audit: string[];
};
const request = makeFunctionReference<"mutation", Record<string, never>, { ok: boolean; code?: string; deleteAfter?: number }>("accountDeletion:request");
const cancel = makeFunctionReference<"mutation", Record<string, never>, { ok: boolean; code?: string }>("accountDeletion:cancel");
const myDeletionStatus = makeFunctionReference<"query", Record<string, never>, Record<string, unknown> | null>("accountDeletion:myDeletionStatus");
const whoami = makeFunctionReference<"query">("identity:whoami");
const purgeDue = makeFunctionReference<"mutation", Record<string, never>, { started: number; disabled: boolean }>("accountDeletion:purgeDue");
const purgeAccountStep = makeFunctionReference<"mutation", { userId: string }, string>("accountDeletion:purgeAccountStep");
const backdateDeletion = makeFunctionReference<"mutation", { usernameKey: string; deleteAfter?: number; status?: "deleting" }, string>("fixtures:backdateDeletion");
const accountResidue = makeFunctionReference<"query", { userId: string }, Residue>("fixtures:accountResidue");
const addTagSuggestion = makeFunctionReference<"mutation", { projectId: string; submitterUsernameKey?: string; status?: string }, null>("fixtures:addTagSuggestion");
const getPublicByUsername = makeFunctionReference<"query", { handle: string }>("profiles:getPublicByUsername");

const set = generateFixtures();
const { a: A } = set.personas;
const asA = () => clientAs(A.subject!);
const admin = () => adminClient();
const residue = (userId: string) => admin().query(accountResidue, { userId });
const anon = anonymousClient();
const favoriteCount = async (slug: string) => ((await anon.query(getPublicBySlug, { slug })) as { favoriteCount: number } | null)?.favoriteCount;

async function untilDone(userId: string, ms = 30_000): Promise<Residue> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await residue(userId);
    if (r.user?.status === "deleted") return r;
    if (Date.now() > end) throw new Error(`purge didn't finish: ${JSON.stringify(r)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D04d account deletion (Convex)", () => {
  let ids: Record<string, string>;
  let userA: string;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
    // Knows A's users ID without changing anything (a far-future date on an active account is ignored).
    userA = await admin().mutation(backdateDeletion, { usernameKey: "fixture-alice" });
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("the fixture gives A more projects than one purge step takes, so batching is exercised", () => {
    expect(set.projects.filter((p) => p.ownerKey === "a" && !p.purged).length).toBeGreaterThan(ACCOUNT_PROJECTS_PER_STEP);
  });

  describe("request", () => {
    it("marks the account deleting for 14 days, hides profile and projects, and refuses it everywhere", async () => {
      const before = await residue(userA);
      expect(before.listedProjects).toBeGreaterThan(0);
      const t0 = Date.now();
      const r = await asA().mutation(request, {});
      expect(r.ok).toBe(true);
      expect(r.deleteAfter! - t0).toBeGreaterThanOrEqual(ACCOUNT_DELETION_GRACE_MS - 60_000);
      expect(r.deleteAfter! - t0).toBeLessThanOrEqual(ACCOUNT_DELETION_GRACE_MS + 60_000);

      // Hiding runs in scheduled batches past the first; wait for it.
      for (let i = 0; i < 50 && (await residue(userA)).listedProjects > 0; i++) await new Promise((res) => setTimeout(res, 200));
      const after = await residue(userA);
      expect(after.user).toMatchObject({ status: "deleting", deleteAfter: r.deleteAfter });
      expect(after.listedProjects).toBe(0);
      expect(after.projects).toBe(before.projects); // hidden, not deleted
      expect(after.audit).toContain("account.deletion_requested");
      expect(await anon.query(getPublicBySlug, { slug: "fixture-listed" })).toBeNull();
      expect(await anon.query(getPublicByUsername, { handle: "fixture-alice" })).toBeNull();
      expect(await asA().query(whoami, {})).toBeNull();
      expect(await asA().query(myDeletionStatus, {})).toEqual({ status: "deleting", deleteAfter: r.deleteAfter, cancellable: true });
      // A second request from a deleting account is refused (getViewer).
      expect(await asA().mutation(request, {})).toEqual({ ok: false, code: "not_signed_in" });
    });

    it("anonymous can't request", async () => {
      expect(await anon.mutation(request, {})).toEqual({ ok: false, code: "not_signed_in" });
    });
  });

  describe("cancel", () => {
    it("inside the grace period puts back exactly what was listed", async () => {
      const before = await residue(userA);
      const listedBefore = await anon.query(getPublicBySlug, { slug: "fixture-listed" });
      await asA().mutation(request, {});
      expect(await asA().mutation(cancel, {})).toEqual({ ok: true });
      for (let i = 0; i < 50 && (await residue(userA)).listedProjects < before.listedProjects; i++) await new Promise((res) => setTimeout(res, 200));
      const after = await residue(userA);
      expect(after.user).toMatchObject({ status: "active" });
      expect(after.user).not.toHaveProperty("deleteAfter");
      expect(after.listedProjects).toBe(before.listedProjects);
      expect(after.audit).toEqual(expect.arrayContaining(["account.deletion_requested", "account.deletion_cancelled"]));
      expect({ ...(await anon.query(getPublicBySlug, { slug: "fixture-listed" })), updatedAt: 0 }).toEqual({ ...listedBefore, updatedAt: 0 });
      expect(await anon.query(getPublicBySlug, { slug: "fixture-private" })).toBeNull();
      expect(await asA().query(whoami, {})).not.toBeNull();
    });

    it("an active account has nothing to cancel; after the date it's too late", async () => {
      expect(await asA().mutation(cancel, {})).toEqual({ ok: false, code: "not_deleting" });
      await asA().mutation(request, {});
      await admin().mutation(backdateDeletion, { usernameKey: "fixture-alice", deleteAfter: Date.now() - 1000 });
      expect(await asA().mutation(cancel, {})).toEqual({ ok: false, code: "too_late" });
      expect(await asA().query(myDeletionStatus, {})).toMatchObject({ status: "deleting", cancellable: false });
    });
  });

  describe("purge", () => {
    it("is not started before the date", async () => {
      await asA().mutation(request, {});
      expect(await admin().mutation(purgeAccountStep, { userId: userA })).toBe("not_due");
      expect((await residue(userA)).profiles).toBe(1);
    });

    it("never starts for an account marked deleting without a date", async () => {
      const userB = await admin().mutation(backdateDeletion, { usernameKey: "fixture-bob", status: "deleting" });
      expect((await admin().mutation(purgeDue, {})).disabled).toBe(false);
      expect(await admin().mutation(purgeAccountStep, { userId: userB })).toBe("not_due");
      expect((await residue(userB)).profiles).toBe(1);
    });

    it("after the date removes everything the account owned, in batches, and leaves a tombstone", async () => {
      await admin().mutation(addTagSuggestion, { projectId: ids["fixture-bob-project"], submitterUsernameKey: "fixture-alice" });
      await admin().mutation(addTagSuggestion, { projectId: ids["fixture-bob-project"], submitterUsernameKey: "fixture-alice", status: "approved" });
      const bobFavoritesBefore = await favoriteCount("fixture-bob-project");
      const before = await residue(userA);
      expect(before.favorites).toBeGreaterThan(0);

      await asA().mutation(request, {});
      await admin().mutation(backdateDeletion, { usernameKey: "fixture-alice", deleteAfter: Date.now() - 1000 });
      expect((await admin().mutation(purgeDue, {})).started).toBe(1);
      const done = await untilDone(userA);

      expect(done).toMatchObject({ projects: 0, listedProjects: 0, favorites: 0, usernames: 0, profiles: 0, authLinks: 0 });
      // The approved suggestion stays, without its submitter; the pending one is gone.
      expect(done.suggestions).toEqual([]);
      expect(done.user).toMatchObject({ status: "deleted", role: "user" });
      for (const key of ["authUserId", "deleteAfter", "deletionRequestedAt"]) expect(done.user).not.toHaveProperty(key);
      expect(done.audit).toEqual(expect.arrayContaining(["account.deletion_requested", "account.deleted"]));
      // A favorited Bob's project; its counter went down by one.
      expect(await favoriteCount("fixture-bob-project")).toBe(bobFavoritesBefore! - 1);
      for (const slug of ["fixture-listed", "fixture-private", "fixture-deleted-recent"]) {
        expect(ids[slug], slug).toBeDefined();
        expect(await anon.query(getPublicBySlug, { slug })).toBeNull();
      }
      // Running it again is harmless.
      expect(await admin().mutation(purgeAccountStep, { userId: userA })).toBe("done");
    });

    it("leaves the reviewed suggestion in place without a submitter", async () => {
      await admin().mutation(addTagSuggestion, { projectId: ids["fixture-bob-project"], submitterUsernameKey: "fixture-alice", status: "approved" });
      await asA().mutation(request, {});
      await admin().mutation(backdateDeletion, { usernameKey: "fixture-alice", deleteAfter: Date.now() - 1000 });
      await admin().mutation(purgeAccountStep, { userId: userA });
      const done = await untilDone(userA);
      expect(done.suggestions).toEqual([]); // none points at A any more
      const projectResidue = makeFunctionReference<"query", { projectId: string }, { counts: Record<string, number> }>("fixtures:projectResidue");
      expect((await admin().query(projectResidue, { projectId: ids["fixture-bob-project"] })).counts.tagSuggestions).toBe(1);
    });
  });

  describe("with a Better Auth login", () => {
    it("request signs out every session; signing in again lets the user see the date and cancel", async () => {
      const email = syntheticEmail("d04d");
      const { jar } = await signUp(email, SYNTHETIC_PASSWORD);
      await verifyEmail(email);
      const token = (await convexToken(jar))!;
      expect(await clientWithToken(token).mutation(request, {})).toMatchObject({ ok: true });
      expect(await clientWithToken(token).query(myDeletionStatus, {})).toBeNull(); // session gone

      const again = await signIn(email, SYNTHETIC_PASSWORD);
      const fresh = (await convexToken(again.jar))!;
      expect(await clientWithToken(fresh).query(whoami, {})).toBeNull();
      expect(await clientWithToken(fresh).query(myDeletionStatus, {})).toMatchObject({ status: "deleting", cancellable: true });
      expect(await clientWithToken(fresh).mutation(cancel, {})).toEqual({ ok: true });
      expect(await clientWithToken(fresh).query(whoami, {})).not.toBeNull();
      expect((await authState(email))?.authUserId).toBeTruthy();
    });

    it("the purge removes the auth user too", async () => {
      const email = syntheticEmail("d04d-purge");
      const { jar } = await signUp(email, SYNTHETIC_PASSWORD);
      await verifyEmail(email);
      const token = (await convexToken(jar))!;
      await clientWithToken(token).mutation(request, {});
      const state = (await authState(email))!;
      const rows = (await accountRows(state.authUserId))!;
      const id = rows.userId;
      await admin().mutation(backdateDeletion, { usernameKey: rows.profiles[0].usernameKey, deleteAfter: Date.now() - 1000 });
      await admin().mutation(purgeAccountStep, { userId: id });
      await untilDone(id);
      expect(await authState(email)).toBeNull();
      expect((await signIn(email, SYNTHETIC_PASSWORD)).status).not.toBe(200);
    });
  });
});
