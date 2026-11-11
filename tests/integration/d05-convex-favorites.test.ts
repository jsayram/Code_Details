// D05-b: favorites:add and favorites:remove on the task-owned test backend
// (P07 §3.9, §5.10, §8; P08 R02, R25, R31). The caller comes only from
// getViewer (each Clerk-era persona's own Better Auth login since
// D08g4c; a fresh sign-up in the last test). Counters move only with a real
// row insert or delete; self-favorites stay out of rankingFavoriteCount; a
// favorite never touches updatedAt or contentVersion.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, authState, clientWithToken, convexToken, signUp, syntheticEmail } from "../fixtures/better-auth";

type FavoriteResult = { ok: true; isFavorite: boolean; favoriteCount: number } | { ok: false; code: "not_found" };
type FavoriteState = {
  project: { favoriteCount: number; rankingFavoriteCount: number; updatedAt: number; contentVersion: number; listed: boolean } | null;
  rows: { username: string | null; listed: boolean; self: boolean }[];
  outbox: { change: string; sourceVersion: number }[];
};

const add = makeFunctionReference<"mutation", { projectId: string }, FavoriteResult>("favorites:add");
const remove = makeFunctionReference<"mutation", { projectId: string }, FavoriteResult>("favorites:remove");
const listMyFavorites = makeFunctionReference<"query", Record<string, never>, { slug: string }[]>("projects:listMyFavorites");
const favoriteState = makeFunctionReference<"query", { projectId: string }, FavoriteState>("fixtures:favoriteState");

const set = generateFixtures();
const { a: A, b: B, deleting } = set.personas;
const asA = () => clientAs(A.subject!);
const asB = () => clientAs(B.subject!);
const BOB = "fixture-bob";
const ALICE = "fixture-alice";

const state = (projectId: string) => adminClient().query(favoriteState, { projectId });
const rowsBy = (s: FavoriteState, username: string) => s.rows.filter((r) => r.username === username);

describe.skipIf(!convexAvailable())("D05 Convex favorites", () => {
  let ids: Record<string, string>;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  /** The call is refused with not_found and the project's favorites, counters and outbox are as before. */
  const refused = async (projectId: string, run: () => Promise<FavoriteResult>) => {
    const before = await state(projectId);
    expect(await run()).toEqual({ ok: false, code: "not_found" });
    expect(await state(projectId)).toEqual(before);
  };

  it("B favorites A's listed project: one listed row, both counters +1, outbox upsert, updatedAt and contentVersion unchanged", async () => {
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    const r = await asB().mutation(add, { projectId: id });
    expect(r).toEqual({ ok: true, isFavorite: true, favoriteCount: before.project!.favoriteCount + 1 });
    const after = await state(id);
    expect(rowsBy(after, BOB)).toEqual([{ username: BOB, listed: true, self: false }]);
    expect(after.project).toEqual({
      ...before.project,
      favoriteCount: before.project!.favoriteCount + 1,
      rankingFavoriteCount: before.project!.rankingFavoriteCount + 1,
    });
    expect(after.outbox).toEqual([...before.outbox, { change: "upsert", sourceVersion: before.project!.contentVersion }]);
    expect((await asB().query(listMyFavorites, {})).map((p) => p.slug)).toContain("fixture-one-tag");
    expect((await asA().query(listMyFavorites, {})).map((p) => p.slug)).not.toContain("fixture-one-tag");
  });

  it("B unfavorites: the row goes, both counters -1", async () => {
    const id = ids["fixture-listed"];
    const before = await state(id);
    expect(await asB().mutation(remove, { projectId: id })).toEqual({ ok: true, isFavorite: false, favoriteCount: before.project!.favoriteCount - 1 });
    const after = await state(id);
    expect(rowsBy(after, BOB)).toEqual([]);
    expect(after.project).toMatchObject({
      favoriteCount: before.project!.favoriteCount - 1,
      rankingFavoriteCount: before.project!.rankingFavoriteCount - 1,
      updatedAt: before.project!.updatedAt,
      contentVersion: before.project!.contentVersion,
    });
  });

  it("self-favorites count on the card but not in ranking, both ways", async () => {
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    expect((await asA().mutation(add, { projectId: id })).ok).toBe(true);
    let s = await state(id);
    expect(rowsBy(s, ALICE)).toEqual([{ username: ALICE, listed: true, self: true }]);
    expect(s.project).toMatchObject({ favoriteCount: before.project!.favoriteCount + 1, rankingFavoriteCount: before.project!.rankingFavoriteCount });
    expect((await asA().mutation(remove, { projectId: id })).ok).toBe(true);
    s = await state(id);
    expect(s.project).toMatchObject({ favoriteCount: before.project!.favoriteCount, rankingFavoriteCount: before.project!.rankingFavoriteCount });
  });

  it("R25: repeated adds and removes change the counters once each", async () => {
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    for (let i = 0; i < 3; i++) expect(await asB().mutation(add, { projectId: id })).toMatchObject({ ok: true, isFavorite: true });
    expect((await state(id)).project).toMatchObject({ favoriteCount: before.project!.favoriteCount + 1, rankingFavoriteCount: before.project!.rankingFavoriteCount + 1 });
    for (let i = 0; i < 3; i++) expect(await asB().mutation(remove, { projectId: id })).toMatchObject({ ok: true, isFavorite: false });
    const after = await state(id);
    expect(after.project).toEqual(before.project);
    expect(rowsBy(after, BOB)).toEqual([]);
    // One upsert per real change, none for the no-ops.
    expect(after.outbox.length).toBe(before.outbox.length + 2);
  });

  it("R25: unfavoriting a project you never favorited changes nothing", async () => {
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    expect(await asB().mutation(remove, { projectId: id })).toEqual({ ok: true, isFavorite: false, favoriteCount: before.project!.favoriteCount });
    expect(await state(id)).toEqual(before);
  });

  it("concurrent: ten simultaneous adds make one row and +1; ten removes make -1", async () => {
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    const client = asB();
    const adds = await Promise.all(Array.from({ length: 10 }, () => client.mutation(add, { projectId: id })));
    expect(adds.every((r) => r.ok)).toBe(true);
    let s = await state(id);
    expect(rowsBy(s, BOB)).toHaveLength(1);
    expect(s.project!.favoriteCount).toBe(before.project!.favoriteCount + 1);
    const removes = await Promise.all(Array.from({ length: 10 }, () => client.mutation(remove, { projectId: id })));
    expect(removes.every((r) => r.ok)).toBe(true);
    s = await state(id);
    expect(rowsBy(s, BOB)).toHaveLength(0);
    expect(s.project).toEqual(before.project);
  });

  it("concurrent mixed from two users: counters equal the rows afterwards", async () => {
    const id = ids["fixture-one-tag"];
    const a = asA();
    const b = asB();
    const ops = Array.from({ length: 20 }, (_, i) => {
      const client = i % 4 < 2 ? a : b;
      return client.mutation(i % 2 === 0 ? add : remove, { projectId: id });
    });
    expect((await Promise.all(ops)).every((r) => r.ok)).toBe(true);
    const s = await state(id);
    expect(s.project!.favoriteCount).toBe(s.rows.length);
    expect(s.project!.rankingFavoriteCount).toBe(s.rows.filter((r) => !r.self).length);
  });

  it("R02: anonymous and deleting callers get not_found and write nothing", async () => {
    const id = ids["fixture-one-tag"];
    await refused(id, () => anonymousClient().mutation(add, { projectId: id }));
    await refused(ids["fixture-listed"], () => anonymousClient().mutation(remove, { projectId: ids["fixture-listed"] }));
    await refused(id, () => clientAs(deleting.subject!).mutation(add, { projectId: id }));
  });

  it("R02: no identity argument is accepted", async () => {
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    const smuggled = { projectId: id, userId: "x" } as unknown as { projectId: string };
    await expect(asB().mutation(add, smuggled)).rejects.toThrow();
    await expect(asB().mutation(remove, smuggled)).rejects.toThrow();
    expect(await state(id)).toEqual(before);
  });

  it("someone else's private project is not_found for add and remove; the owner may favorite it, unlisted and with no outbox", async () => {
    const id = ids["fixture-private"];
    await refused(id, () => asB().mutation(add, { projectId: id }));
    await refused(id, () => asB().mutation(remove, { projectId: id }));
    const before = await state(id);
    expect((await asA().mutation(add, { projectId: id })).ok).toBe(true);
    const s = await state(id);
    expect(rowsBy(s, ALICE)).toEqual([{ username: ALICE, listed: false, self: true }]);
    expect(s.outbox).toEqual(before.outbox);
    expect((await asA().query(listMyFavorites, {})).map((p) => p.slug)).not.toContain("fixture-private");
  });

  it("a deleted project can't be favorited, but an existing favorite on it can be removed (counters follow, no outbox)", async () => {
    const id = ids["fixture-deleted-recent"];
    await refused(id, () => asA().mutation(add, { projectId: id }));
    await refused(id, () => asA().mutation(remove, { projectId: id }));
    const before = await state(id);
    expect(rowsBy(before, BOB)).toHaveLength(1);
    expect((await asB().mutation(remove, { projectId: id })).ok).toBe(true);
    const after = await state(id);
    expect(rowsBy(after, BOB)).toHaveLength(0);
    expect(after.project).toMatchObject({
      favoriteCount: before.project!.favoriteCount - 1,
      rankingFavoriteCount: before.project!.rankingFavoriteCount - 1,
      updatedAt: before.project!.updatedAt,
    });
    expect(after.outbox).toEqual(before.outbox);
  });

  it("missing and malformed IDs are not_found", async () => {
    for (const projectId of ["not-an-id", ids["fixture-listed"].slice(0, -2) + "zz"]) {
      expect(await asB().mutation(add, { projectId })).toEqual({ ok: false, code: "not_found" });
      expect(await asB().mutation(remove, { projectId })).toEqual({ ok: false, code: "not_found" });
    }
  });

  it("a real Better Auth login favorites as its own account, never as anyone else", async () => {
    const email = syntheticEmail("d05-favorites");
    const res = await signUp(email, SYNTHETIC_PASSWORD);
    expect(res.status).toBe(200);
    expect((await authState(email))!.authUserId).toBeTruthy();
    const id = ids["fixture-one-tag"];
    const before = await state(id);
    const client = clientWithToken((await convexToken(res.jar))!);
    expect(await client.mutation(add, { projectId: id })).toMatchObject({ ok: true, isFavorite: true });
    const after = await state(id);
    expect(after.rows).toHaveLength(before.rows.length + 1);
    expect(after.rows.filter((r) => r.username === BOB || r.username === ALICE)).toEqual(before.rows.filter((r) => r.username === BOB || r.username === ALICE));
    expect(after.project!.rankingFavoriteCount).toBe(before.project!.rankingFavoriteCount + 1);
  });
});
