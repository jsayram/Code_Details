// D09 S02a: projects.searchText and the search_public index follow every
// write path on the task-owned test backend. Listed projects carry the S00.2
// projection run through the vocabulary layer; private, deleted and purged
// projects carry nothing, so the index can't return them.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, warmPersonas } from "../fixtures/convex-auth";

type SearchState = { searchText: string | null; listed: boolean } | null;
const searchState = makeFunctionReference<"query", { projectId: string }, SearchState>("fixtures:searchState");
const searchProbe = makeFunctionReference<"query", { q: string }, string[]>("fixtures:searchProbe");
const profileIdOf = makeFunctionReference<"query", { usernameKey: string }, string | null>("fixtures:profileIdOf");
const update = makeFunctionReference<"mutation", { projectId: string; expectedContentVersion: number; patch: Record<string, unknown> }, { ok: boolean; project?: { contentVersion: number } }>("projects:update");
const create = makeFunctionReference<"mutation", { project: Record<string, unknown> }, { ok: boolean; project?: { id: string } }>("projectLifecycle:create");
const softDelete = makeFunctionReference<"mutation", { projectId: string }, { ok: boolean }>("projectLifecycle:softDelete");
const restore = makeFunctionReference<"mutation", { projectId: string }, { ok: boolean }>("projectLifecycle:restore");
const addFavorite = makeFunctionReference<"mutation", { projectId: string }, { ok: boolean }>("favorites:add");
const updateMine = makeFunctionReference<"mutation", { currentHandle: string; patch: Record<string, unknown> }, { ok: boolean }>("profiles:updateMine");
const updateUser = makeFunctionReference<"mutation", { targetProfileId: string; patch: Record<string, unknown> }, { ok: boolean }>("admin:updateUser");
const requestDeletion = makeFunctionReference<"mutation", Record<string, never>, { ok: boolean }>("accountDeletion:request");
const editable = makeFunctionReference<"query", { slug: string }, { contentVersion: number } | null>("projects:getMineForEdit");

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const asA = () => clientAs(A.subject!);
const asB = () => clientAs(B.subject!);

async function eventually<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe.skipIf(!convexAvailable())("D09 S02a search index sync", () => {
  let ids: Record<string, string>;
  const text = async (slug: string) => (await adminClient().query(searchState, { projectId: ids[slug] }))?.searchText ?? null;
  const probe = (q: string) => adminClient().query(searchProbe, { q });
  const version = async (slug: string) => (await asA().query(editable, { slug }))!.contentVersion;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
    await warmPersonas([A, B, admin].map((p) => p.subject!));
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("loaded fixtures: listed projects have searchText, ineligible ones none", async () => {
    const listed = await text("fixture-listed");
    expect(listed).toContain("Fixture Listed Project");
    expect(listed).toContain("fixture-alice");
    expect(listed).toContain("zznextjszz");
    expect(listed).toContain("zzpostgresqlzz");
    for (const slug of ["fixture-private", "fixture-deleted-recent", "fixture-deleted-long-ago"]) expect(await text(slug), slug).toBeNull();
  });

  it("the index keeps C, C++ and C# apart and finds aliases, never an ineligible project", async () => {
    const csharp = await probe("c#");
    expect(csharp).toContain("fixture-one-tag");
    expect(csharp).not.toContain("fixture-listed");
    expect(await probe("postgresql")).toContain("fixture-listed");
    expect(await probe("golang")).toContain("fixture-legacy-owner");
    for (const q of ["private", "deleted", "fixture"]) {
      const hits = await probe(q);
      for (const slug of ["fixture-private", "fixture-deleted-recent", "fixture-deleted-long-ago", "fixture-purged"]) expect(hits, `${q}: ${slug}`).not.toContain(slug);
    }
  });

  // No mutation sets a project private yet (create is always public); the
  // fixture's private project covers that state above.
  it("an edit is searchable at once, and the old text stops matching at once", async () => {
    let r = await asA().mutation(update, { projectId: ids["fixture-listed"], expectedContentVersion: await version("fixture-listed"), patch: { title: "Quokka Relay" } });
    expect(r.ok).toBe(true);
    expect(await probe("quokka")).toContain("fixture-listed");
    expect(await text("fixture-listed")).toContain("Quokka Relay");
    r = await asA().mutation(update, { projectId: ids["fixture-listed"], expectedContentVersion: r.project!.contentVersion, patch: { title: "Platypus Relay", tags: ["C"] } });
    expect(r.ok).toBe(true);
    expect(await probe("quokka")).not.toContain("fixture-listed");
    expect(await probe("platypus")).toContain("fixture-listed");
    expect(await probe("postgresql")).not.toContain("fixture-listed");
    expect(await probe("c")).toContain("fixture-listed");
  });

  it("delete clears it, restore brings it back, create indexes the new project", async () => {
    expect((await asA().mutation(softDelete, { projectId: ids["fixture-one-tag"] })).ok).toBe(true);
    expect(await text("fixture-one-tag")).toBeNull();
    expect(await probe("c#")).not.toContain("fixture-one-tag");
    expect((await asA().mutation(restore, { projectId: ids["fixture-one-tag"] })).ok).toBe(true);
    expect(await probe("c#")).toContain("fixture-one-tag");
    const made = await asA().mutation(create, {
      project: { title: "Wombat Mapper", slug: "fixture-d09-wombat", description: "Made by a test.", category: "web", tags: ["C++"], links: [] },
    });
    expect(made.ok).toBe(true);
    expect(await probe("wombat")).toContain("fixture-d09-wombat");
    expect(await probe("c++")).toContain("fixture-d09-wombat");
  });

  it("a favorite doesn't change searchText", async () => {
    const before = await text("fixture-listed");
    expect((await asB().mutation(addFavorite, { projectId: ids["fixture-one-tag"] })).ok).toBe(true);
    expect(await text("fixture-listed")).toBe(before);
  });

  it("the owner's rename and new display name reach every one of their listed projects", async () => {
    expect((await asA().mutation(updateMine, { currentHandle: "fixture-alice", patch: { handle: "fixture-alicia", fullName: "Alicia Numbat" } })).ok).toBe(true);
    for (const slug of ["fixture-listed", "fixture-one-tag"]) {
      const t = await text(slug);
      expect(t, slug).toContain("fixture-alicia");
      expect(t, slug).toContain("Alicia Numbat");
      expect(t, slug).not.toContain("fixture-alice ");
    }
    expect(await probe("numbat")).toEqual(expect.arrayContaining(["fixture-listed", "fixture-one-tag"]));
    expect(await probe("numbat")).not.toContain("fixture-bob-project");
  });

  it("an admin's change to a user's name reaches that user's projects", async () => {
    const bob = await adminClient().query(profileIdOf, { usernameKey: "fixture-bob" });
    expect((await clientAs(admin.subject!).mutation(updateUser, { targetProfileId: bob!, patch: { fullName: "Robert Echidna" } })).ok).toBe(true);
    expect(await text("fixture-bob-project")).toContain("Robert Echidna");
    expect(await probe("echidna")).toEqual(["fixture-bob-project"]);
  });

  it("an account deletion request takes the owner's projects out of search", async () => {
    expect((await asA().mutation(requestDeletion, {})).ok).toBe(true);
    const gone = await eventually(() => text("fixture-listed"), (t) => t === null);
    expect(gone).toBeNull();
    expect(await probe("fixture listed")).not.toContain("fixture-listed");
  });
});
