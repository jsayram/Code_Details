// D06-c: the orphan sweep on the task-owned test backend (P07 §3.10, §5.11).
// push.mjs set CODEDETAILS_IMAGE_SWEEP_ALLOWED=1 here, as it does only for the
// test target. Files can't be backdated, so the tests pass minAgeMs (internal,
// admin key only) where the cron uses 24 hours. Vitest runs files one at a
// time, so no other file's upload is in flight.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";

type Sweep = { disabled: true } | { disabled: false; examined: number; deleted: number; continuing: boolean };
const sweep = makeFunctionReference<"mutation", { minAgeMs?: number; batch?: number }, Sweep>("projectImages:sweepOrphans");
const store = makeFunctionReference<"action", { contentType: string; bytes: number }, string>("fixtures:storeUnattachedFile");
const addImages = makeFunctionReference<"action", { projectId: string; count: number }, string[]>("fixtures:addProjectImages");
const fileExists = makeFunctionReference<"query", { storageId: string }, boolean>("fixtures:fileExists");
const setStoredAvatar = makeFunctionReference<"mutation", { usernameKey: string; storageId: string }, null>("fixtures:setStoredAvatar");
const imageState = makeFunctionReference<"query", { projectId: string }, { status: string; fileExists: boolean }[]>("fixtures:imageState");

const set = generateFixtures();
const exists = (storageId: string) => adminClient().query(fileExists, { storageId });
const orphan = () => adminClient().action(store, { contentType: "image/png", bytes: 32 });

describe.skipIf(!convexAvailable())("D06-c orphan image sweep", () => {
  let ids: Record<string, string>;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
    // Start from a store with no leftovers from earlier files.
    await adminClient().mutation(sweep, { minAgeMs: 0 });
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("deletes an old unattached upload and keeps every file an image row points at", async () => {
    const lost = await orphan();
    const [cover, softDeleted] = await adminClient().action(addImages, { projectId: ids["fixture-listed"], count: 2 });
    const r = await adminClient().mutation(sweep, { minAgeMs: 0 });
    expect(r).toMatchObject({ disabled: false, deleted: 1, continuing: false });
    expect(await exists(lost)).toBe(false);
    expect(await exists(cover)).toBe(true);
    expect(await exists(softDeleted)).toBe(true); // a soft-deleted image keeps its file (§5.11)
    expect(await adminClient().query(imageState, { projectId: ids["fixture-listed"] })).toEqual([
      expect.objectContaining({ status: "active", fileExists: true }),
      expect.objectContaining({ status: "deleted", fileExists: true }),
    ]);
  });

  it("keeps a file a profile uses as its stored avatar", async () => {
    const avatar = await orphan();
    await adminClient().mutation(setStoredAvatar, { usernameKey: "fixture-alice", storageId: avatar });
    expect(await adminClient().mutation(sweep, { minAgeMs: 0 })).toMatchObject({ disabled: false, deleted: 0 });
    expect(await exists(avatar)).toBe(true);
  });

  it("leaves uploads younger than 24 hours alone (the cron's default)", async () => {
    const fresh = await orphan();
    expect(await adminClient().mutation(sweep, {})).toMatchObject({ disabled: false, deleted: 0 });
    expect(await exists(fresh)).toBe(true);
  });

  it("works in bounded steps and reschedules itself until it has seen every file", async () => {
    const lost = [];
    for (let i = 0; i < 5; i++) lost.push(await orphan());
    const keep = await adminClient().action(addImages, { projectId: ids["fixture-listed"], count: 1 });
    const first = await adminClient().mutation(sweep, { minAgeMs: 0, batch: 2 });
    expect(first).toMatchObject({ disabled: false, examined: 2, continuing: true });
    for (const id of lost) await expect.poll(() => exists(id), { timeout: 15_000 }).toBe(false);
    expect(await exists(keep[0])).toBe(true);
  });
});
