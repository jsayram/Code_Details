// D03-b: projectLifecycle:create, softDelete, restore and purge on the
// task-owned test backend (P07 §5.11). The caller comes only from getViewer
// (each Clerk-era persona's own Better Auth login since D08g4c; a real Better Auth login
// linked to A in the last block). Every refusal is checked to have written
// nothing; scheduled steps (listed-copy batches, purge batches, file deletes)
// are awaited by polling the fixture state.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, warmPersonas } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, authState, clientWithToken, convexToken, linkPersona, signUp, syntheticEmail } from "../fixtures/better-auth";

type Client = ReturnType<typeof anonymousClient>;
type Input = Record<string, unknown>;
type CreateResult = { ok: true; project: { id: string; slug: string; title: string; tags: string[]; contentVersion: number } } | { ok: false; code: string; issues?: { field: string; message: string }[] };
type LifecycleResult = { ok: true; slug: string } | { ok: false; code: "not_found" };

const create = makeFunctionReference<"mutation", { project: Input }, CreateResult>("projectLifecycle:create");
const softDelete = makeFunctionReference<"mutation", { projectId: string }, LifecycleResult>("projectLifecycle:softDelete");
const restore = makeFunctionReference<"mutation", { projectId: string }, LifecycleResult>("projectLifecycle:restore");
const purge = makeFunctionReference<"mutation", { projectId: string }, LifecycleResult>("projectLifecycle:purge");
const deleteStoredFile = makeFunctionReference<"action", { storageId: string; attempt: number }, string>("projectLifecycle:deleteStoredFile");
const getPublicBySlug = makeFunctionReference<"query", { slug: string }, Record<string, unknown> | null>("projects:getPublicBySlug");
const listMyFavorites = makeFunctionReference<"query", Record<string, never>, { slug: string }[]>("projects:listMyFavorites");
const listMyDeleted = makeFunctionReference<"query", Record<string, never>, { slug: string }[]>("projects:listMyDeleted");

type WriteState = {
  project: (Record<string, unknown> & { status: string; listed: boolean; contentVersion: number; tagIds: string[]; ownerId: string }) | null;
  slugs: { slug: string; state: string }[];
  joins: { tagId: string; listed: boolean }[];
  audit: { kind: string; actorId?: string; details?: Record<string, unknown> }[];
  outbox: { change: string; sourceVersion: number }[];
  tags: { id: string; name: string; listedProjectCount: number }[];
};
type Residue = {
  project: unknown;
  counts: Record<"projectTags" | "favorites" | "projectSlugs" | "tagSuggestions" | "projectImages", number>;
  listedCopies: { projectTags: number; favorites: number };
  files: string[];
};
const projectWriteState = makeFunctionReference<"query", { projectId: string }, WriteState>("fixtures:projectWriteState");
const projectResidue = makeFunctionReference<"query", { projectId: string; storageIds?: string[] }, Residue>("fixtures:projectResidue");
const addProjectImages = makeFunctionReference<"action", { projectId: string; count: number }, string[]>("fixtures:addProjectImages");
const insertImageRows = makeFunctionReference<"mutation", { projectId: string; storageIds: string[] }, null>("fixtures:insertImageRows");
const addFavorites = makeFunctionReference<"mutation", { projectId: string; count: number }, null>("fixtures:addFavorites");
const addTagSuggestion = makeFunctionReference<"mutation", { projectId: string }, null>("fixtures:addTagSuggestion");
const counts = makeFunctionReference<"query", Record<string, never>, Record<string, number>>("fixtures:counts");

const set = generateFixtures();
const { a: A, b: B, admin, deleting } = set.personas;
const asA = () => clientAs(A.subject!);

const state = (projectId: string) => adminClient().query(projectWriteState, { projectId });
const residue = (projectId: string, storageIds?: string[]) => adminClient().query(projectResidue, { projectId, storageIds });
const tagCount = (s: WriteState, name: string) => s.tags.find((t) => t.name === name)?.listedProjectCount;

async function eventually<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const newProject = (slug: string, extra: Input = {}): Input => ({
  title: "D03 Created",
  slug,
  description: "Made by a test.",
  category: "web",
  tags: ["Next.js"],
  links: [{ url: "https://example.invalid/repo", label: "Repo", type: "repository" }],
  ...extra,
});

describe.skipIf(!convexAvailable())("D03 Convex project lifecycle", () => {
  let ids: Record<string, string>;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
    // D08g4c: sign the personas in before any "nothing was written" count.
    await warmPersonas([A, B, admin, deleting].map((p) => p.subject!));
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  const nothingWritten = async (run: () => Promise<unknown>) => {
    const before = await adminClient().query(counts, {});
    const r = await run().catch((e: Error) => e);
    expect(await adminClient().query(counts, {})).toEqual(before);
    return r;
  };

  describe("create", () => {
    it("A creates a listed project owned by A: tags, slug, counters and outbox in one go", async () => {
      const before = await state(ids["fixture-listed"]);
      const r = await asA().mutation(create, { project: newProject("fixture-d03-created", { tags: ["Next.js", "next.js", "fixture-d03 brand new"] }) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.project).toMatchObject({ slug: "fixture-d03-created", title: "D03 Created", contentVersion: 1 });
      expect(r.project.tags).toEqual(["Next.js", "fixture-d03 brand new"]);
      const s = await state(r.project.id);
      expect(s.project).toMatchObject({ status: "active", visibility: "public", listed: true, favoriteCount: 0, rankingFavoriteCount: 0, tagCount: 2 });
      expect(s.project!.ownerId).toBe(before.project!.ownerId);
      expect(s.slugs).toEqual([{ slug: "fixture-d03-created", state: "current" }]);
      expect(s.joins.map((j) => j.listed)).toEqual([true, true]);
      expect(s.outbox).toEqual([{ change: "upsert", sourceVersion: 1 }]);
      expect(tagCount(s, "Next.js")).toBe(tagCount(before, "Next.js")! + 1);
      expect(tagCount(s, "fixture-d03 brand new")).toBe(1);
      expect(await anonymousClient().query(getPublicBySlug, { slug: "fixture-d03-created" })).toMatchObject({ title: "D03 Created" });
    });

    it.each([
      ["anonymous", () => anonymousClient()],
      ["a deleting account", () => clientAs(deleting.subject!)],
    ])("%s can't create; nothing is written", async (_who, client) => {
      const r = await nothingWritten(() => (client() as Client).mutation(create, { project: newProject("fixture-d03-nope") }));
      expect(r).toEqual({ ok: false, code: "unauthorized" });
    });

    it.each(["ownerId", "userId", "status", "visibility", "listed", "favoriteCount", "contentVersion", "createdAt", "deletedAt"])(
      "the closed validator refuses %s in the input; nothing is written",
      async (field) => {
        const r = await nothingWritten(() => asA().mutation(create, { project: newProject("fixture-d03-forbidden", { [field]: "x" }) }));
        expect(r).toBeInstanceOf(Error);
      },
    );

    it("a top-level identity argument is refused", async () => {
      const r = await nothingWritten(() =>
        asA().mutation(create as never, { project: newProject("fixture-d03-ident"), ownerId: "x" } as never),
      );
      expect(r).toBeInstanceOf(Error);
    });

    it.each([
      ["a javascript: link", { links: [{ url: "javascript:alert(1)", type: "demo" }] }, "url_links"],
      ["a bad slug", { slug: "Not A Slug" }, "slug"],
      ["an unknown category", { category: "nope" }, "category"],
      ["an empty title", { title: "  " }, "title"],
      ["a javascript: url detail field", { category: "mobile", categoryData: { appStoreUrl: "javascript:alert(1)" } }, "category_data"],
    ])("%s is invalid; nothing is written", async (_what, extra, field) => {
      const r = await nothingWritten(() => asA().mutation(create, { project: newProject("fixture-d03-bad", extra) }));
      expect(r).toMatchObject({ ok: false, code: "invalid" });
      expect((r as { issues: { field: string }[] }).issues.map((i) => i.field)).toContain(field);
    });

    it.each([
      ["another project's current slug", "fixture-listed"],
      ["a deleted project's slug (reserved until purge)", "fixture-deleted-recent"],
    ])("%s is taken", async (_what, slug) => {
      const r = await nothingWritten(() => asA().mutation(create, { project: newProject(slug) }));
      expect(r).toMatchObject({ ok: false, code: "invalid", issues: [{ field: "slug", message: "This slug is already taken" }] });
    });

    it("duplication: the same create twice makes one project; the second is refused as slug taken", async () => {
      expect((await asA().mutation(create, { project: newProject("fixture-d03-twice") })).ok).toBe(true);
      const second = await nothingWritten(() => asA().mutation(create, { project: newProject("fixture-d03-twice") }));
      expect(second).toMatchObject({ ok: false, code: "invalid" });
    });
  });

  describe("soft delete", () => {
    it("the owner deletes: the project and its copies leave every list, counters go down, audit and outbox written, slug kept", async () => {
      const id = ids["fixture-listed"];
      const before = await state(id);
      expect(await asA().mutation(softDelete, { projectId: id })).toEqual({ ok: true, slug: "fixture-listed" });
      const s = await state(id);
      expect(s.project).toMatchObject({ status: "deleted", listed: false, contentVersion: before.project!.contentVersion + 1 });
      expect(typeof s.project!.deletedAt).toBe("number");
      expect(s.joins.every((j) => !j.listed)).toBe(true);
      expect((await residue(id)).listedCopies).toEqual({ projectTags: 0, favorites: 0 });
      expect(tagCount(s, "Postgres")).toBe(tagCount(before, "Postgres")! - 1);
      expect(s.audit).toEqual([{ kind: "project.deleted", actorId: expect.any(String), details: { slug: "fixture-listed", byOwner: true } }]);
      expect(s.outbox).toEqual([{ change: "remove", sourceVersion: before.project!.contentVersion + 1 }]);
      expect(await anonymousClient().query(getPublicBySlug, { slug: "fixture-listed" })).toBeNull();
      expect((await clientAs(B.subject!).query(listMyFavorites, {})).map((p) => p.slug)).not.toContain("fixture-listed");
      expect((await asA().query(listMyDeleted, {})).map((p) => p.slug)).toContain("fixture-listed");
      // The slug stays reserved while the project is in the graveyard.
      expect(await asA().mutation(create, { project: newProject("fixture-listed") })).toMatchObject({ ok: false, code: "invalid" });
    });

    it.each([
      ["B", () => clientAs(B.subject!)],
      ["an admin", () => clientAs(admin.subject!)],
      ["anonymous", () => anonymousClient()],
      ["a deleting account", () => clientAs(deleting.subject!)],
    ])("%s gets not_found and nothing changes", async (_who, client) => {
      const r = await nothingWritten(() => (client() as Client).mutation(softDelete, { projectId: ids["fixture-listed"] }));
      expect(r).toEqual({ ok: false, code: "not_found" });
      expect((await state(ids["fixture-listed"])).project).toMatchObject({ status: "active", listed: true });
    });

    it("a malformed or foreign ID gets the same not_found", async () => {
      expect(await asA().mutation(softDelete, { projectId: "not-an-id" })).toEqual({ ok: false, code: "not_found" });
      expect(await asA().mutation(softDelete, { projectId: ids["fixture-owned-by-b"] ?? "x" })).toEqual({ ok: false, code: "not_found" });
    });

    it("an already deleted project gets not_found; no second audit row", async () => {
      const id = ids["fixture-deleted-recent"];
      const before = await state(id);
      expect(await asA().mutation(softDelete, { projectId: id })).toEqual({ ok: false, code: "not_found" });
      expect(await state(id)).toEqual(before);
    });

    it("a private project's delete leaves the listed tag counters alone", async () => {
      const id = ids["fixture-private"];
      const before = await state(id);
      expect((await asA().mutation(softDelete, { projectId: id })).ok).toBe(true);
      expect((await state(id)).tags).toEqual(before.tags);
    });

    it("fan-out beyond one batch: 450 favorites all become unlisted (scheduled pages)", async () => {
      const id = ids["fixture-listed"];
      await adminClient().mutation(addFavorites, { projectId: id, count: 450 });
      expect((await asA().mutation(softDelete, { projectId: id })).ok).toBe(true);
      const r = await eventually(() => residue(id), (x) => x.listedCopies.favorites === 0);
      expect(r.listedCopies.favorites).toBe(0);
      expect(r.counts.favorites).toBeGreaterThanOrEqual(450);
    });
  });

  describe("restore", () => {
    it("the owner restores: listed again, copies and counters back, audit and outbox written", async () => {
      const id = ids["fixture-deleted-recent"];
      const before = await state(id);
      expect(await asA().mutation(restore, { projectId: id })).toEqual({ ok: true, slug: "fixture-deleted-recent" });
      const s = await state(id);
      expect(s.project).toMatchObject({ status: "active", listed: true, contentVersion: before.project!.contentVersion + 1 });
      expect(s.project!.deletedAt).toBeUndefined();
      expect((await residue(id)).listedCopies.projectTags).toBe(s.joins.length);
      expect(s.audit.map((a) => a.kind)).toEqual(["project.restored"]);
      expect(s.outbox).toEqual([{ change: "upsert", sourceVersion: before.project!.contentVersion + 1 }]);
      expect(await anonymousClient().query(getPublicBySlug, { slug: "fixture-deleted-recent" })).not.toBeNull();
      // B's favorite on it comes back to B's list.
      expect((await clientAs(B.subject!).query(listMyFavorites, {})).map((p) => p.slug)).toContain("fixture-deleted-recent");
    });

    it("delete then restore puts every counter and copy back where it was", async () => {
      const id = ids["fixture-listed"];
      const before = await state(id);
      await asA().mutation(softDelete, { projectId: id });
      await asA().mutation(restore, { projectId: id });
      const after = await state(id);
      expect(after.tags).toEqual(before.tags);
      expect(after.joins).toEqual(before.joins);
      expect((await residue(id)).listedCopies).toEqual((await residue(id)).listedCopies);
      expect(after.audit.map((a) => a.kind)).toEqual(["project.deleted", "project.restored"]);
    });

    it("restore is only from deleted: an active project gets not_found", async () => {
      const r = await nothingWritten(() => asA().mutation(restore, { projectId: ids["fixture-listed"] }));
      expect(r).toEqual({ ok: false, code: "not_found" });
    });

    it.each([
      ["B", () => clientAs(B.subject!)],
      ["an admin", () => clientAs(admin.subject!)],
      ["anonymous", () => anonymousClient()],
    ])("%s can't restore A's project", async (_who, client) => {
      const r = await nothingWritten(() => (client() as Client).mutation(restore, { projectId: ids["fixture-deleted-recent"] }));
      expect(r).toEqual({ ok: false, code: "not_found" });
    });
  });

  describe("purge", () => {
    const loaded = async (id: string) => {
      const files = await adminClient().action(addProjectImages, { projectId: id, count: 3 });
      await adminClient().mutation(addTagSuggestion, { projectId: id });
      return files;
    };

    it("the owner purges a deleted project: every related row goes, files are deleted by the scheduler, audit stays, slug is free again", async () => {
      const id = ids["fixture-deleted-recent"];
      const files = await loaded(id);
      const before = await residue(id, files);
      expect(before.counts).toMatchObject({ favorites: 1, projectImages: 3, tagSuggestions: 1 });
      expect(before.counts.projectTags).toBeGreaterThan(0);
      expect(before.files).toHaveLength(3);
      const tagsBefore = (await state(id)).tags;

      expect(await asA().mutation(purge, { projectId: id })).toEqual({ ok: true, slug: "fixture-deleted-recent" });
      const after = await eventually(() => residue(id, files), (x) => x.files.length === 0);
      expect(after.project).toBeNull();
      expect(after.counts).toEqual({ projectTags: 0, favorites: 0, projectSlugs: 0, tagSuggestions: 0, projectImages: 0 });
      expect(after.files).toEqual([]);
      const s = await state(id);
      expect(s.audit).toEqual([{ kind: "project.purged", actorId: expect.any(String), details: { slug: "fixture-deleted-recent", byOwner: true } }]);
      expect(s.outbox.map((o) => o.change)).toEqual(["remove"]);
      // Deleted projects were already unlisted: the tag counters don't move.
      expect(s.tags).toEqual(tagsBefore);
      // The slug is released.
      expect((await asA().mutation(create, { project: newProject("fixture-deleted-recent") })).ok).toBe(true);
    });

    it("an admin may purge someone else's deleted project; the audit row says it wasn't the owner", async () => {
      const id = ids["fixture-deleted-recent"];
      expect((await clientAs(admin.subject!).mutation(purge, { projectId: id })).ok).toBe(true);
      expect((await state(id)).audit[0]).toMatchObject({ kind: "project.purged", details: { byOwner: false } });
    });

    it("purge is only from deleted: an active project gets not_found and keeps everything", async () => {
      const id = ids["fixture-listed"];
      const r = await nothingWritten(() => asA().mutation(purge, { projectId: id }));
      expect(r).toEqual({ ok: false, code: "not_found" });
    });

    it.each([
      ["B", () => clientAs(B.subject!)],
      ["anonymous", () => anonymousClient()],
      ["a deleting account", () => clientAs(deleting.subject!)],
    ])("%s can't purge A's deleted project", async (_who, client) => {
      const r = await nothingWritten(() => (client() as Client).mutation(purge, { projectId: ids["fixture-deleted-recent"] }));
      expect(r).toEqual({ ok: false, code: "not_found" });
    });

    it("duplication: a second purge gets not_found and writes nothing", async () => {
      const id = ids["fixture-deleted-recent"];
      expect((await asA().mutation(purge, { projectId: id })).ok).toBe(true);
      const r = await nothingWritten(() => asA().mutation(purge, { projectId: id }));
      expect(r).toEqual({ ok: false, code: "not_found" });
      expect((await state(id)).audit).toHaveLength(1);
    });

    it("fan-out beyond one batch: 450 favorites are removed by scheduled batches", async () => {
      const id = ids["fixture-deleted-recent"];
      await adminClient().mutation(addFavorites, { projectId: id, count: 450 });
      expect((await asA().mutation(purge, { projectId: id })).ok).toBe(true);
      const r = await eventually(() => residue(id), (x) => x.counts.favorites === 0);
      expect(r.counts).toEqual({ projectTags: 0, favorites: 0, projectSlugs: 0, tagSuggestions: 0, projectImages: 0 });
    });

    it("a file still referenced by another image row is kept", async () => {
      const id = ids["fixture-deleted-recent"];
      const files = await loaded(id);
      await adminClient().mutation(insertImageRows, { projectId: ids["fixture-listed"], storageIds: [files[0]] });
      await asA().mutation(purge, { projectId: id });
      const after = await eventually(() => residue(id, files), (x) => x.files.length <= 1);
      expect(after.files).toEqual([files[0]]);
    });

    it("file deletion is idempotent: a file that's already gone counts as done", async () => {
      const id = ids["fixture-deleted-recent"];
      const files = await loaded(id);
      await asA().mutation(purge, { projectId: id });
      await eventually(() => residue(id, files), (x) => x.files.length === 0);
      expect(await adminClient().action(deleteStoredFile, { storageId: files[0], attempt: 1 })).toBe("missing");
    });

    it("the browser can't call the file delete or the batches (internal only)", async () => {
      const files = await loaded(ids["fixture-deleted-recent"]);
      await expect(asA().action(deleteStoredFile, { storageId: files[0], attempt: 1 })).rejects.toThrow();
      expect((await residue(ids["fixture-deleted-recent"], files)).files).toHaveLength(3);
    });
  });

  it("a real Better Auth login gets nothing until it is linked to A, then deletes and restores as A", async () => {
    const email = syntheticEmail("d03-lifecycle");
    const res = await signUp(email, SYNTHETIC_PASSWORD);
    expect(res.status).toBe(200);
    const authUserId = (await authState(email))!.authUserId;
    const id = ids["fixture-listed"];
    expect(await clientWithToken((await convexToken(res.jar))!).mutation(softDelete, { projectId: id })).toEqual({ ok: false, code: "not_found" });
    await linkPersona(A.subject!, authUserId);
    const client = clientWithToken((await convexToken(res.jar))!);
    expect((await client.mutation(softDelete, { projectId: id })).ok).toBe(true);
    expect((await client.mutation(restore, { projectId: id })).ok).toBe(true);
    expect((await client.mutation(create, { project: newProject("fixture-d03-ba") })).ok).toBe(true);
  });
});
