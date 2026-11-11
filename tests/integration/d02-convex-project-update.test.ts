// D02: projects:update, projects:getMineForEdit and projects:currentSlug on the
// task-owned test backend. The caller comes only from getViewer (each
// Clerk-era persona's own Better Auth login since D08g4c, and one more login
// linked to A for the last block). Every refusal is checked to have written nothing.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, type PersonaClient, personaAuthUserId, forgetPersonaLogins } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, authState, clientWithToken, convexToken, linkPersona, signUp, syntheticEmail } from "../fixtures/better-auth";

/** The same ID with its last character changed (never to itself: an ID ending in "x" made this the real ID). */
const otherLastChar = (id: string) => id.slice(0, -1) + (id.endsWith("x") ? "y" : "x");

type Patch = Record<string, unknown>;
type Args = { projectId: string; expectedContentVersion: number; patch: Patch };
type Editable = { id: string; slug: string; title: string; tags: string[]; contentVersion: number; description: string | null } & Record<string, unknown>;
type Result =
  | { ok: true; project: Editable; previousSlug: string | null }
  | { ok: false; code: "not_found" | "stale" | "invalid"; issues?: { field: string; message: string }[]; contentVersion?: number };

const update = makeFunctionReference<"mutation", Args, Result>("projects:update");
const getMineForEdit = makeFunctionReference<"query", { slug: string }, (Editable & { viewerAuthSubject: string; deletedAt: string | null }) | null>("projects:getMineForEdit");
const currentSlug = makeFunctionReference<"query", { slug: string }, string | null>("projects:currentSlug");
const getPublicBySlug = makeFunctionReference<"query", { slug: string }, Record<string, unknown> | null>("projects:getPublicBySlug");

type State = {
  project: Record<string, unknown> & { contentVersion: number; slug: string; tagIds: string[]; tagCount: number; updatedAt: number };
  slugs: { slug: string; state: string }[];
  joins: { tagId: string; position: number; listed: boolean }[];
  audit: { kind: string; actorId?: string; details?: Record<string, unknown> }[];
  outbox: { change: string; sourceVersion: number }[];
  tags: { id: string; name: string; nameKey: string; listedProjectCount: number; status: string }[];
};
const projectWriteState = makeFunctionReference<"query", { projectId: string }, State>("fixtures:projectWriteState");
const state = (projectId: string) => adminClient().query(projectWriteState, { projectId });

const set = generateFixtures();
const { a: A, b: B, admin, deleting } = set.personas;

const asA = () => clientAs(A.subject!);
const tagCount = (s: State, name: string) => s.tags.find((t) => t.name === name)?.listedProjectCount;

describe.skipIf(!convexAvailable())("D02 Convex project update", () => {
  let ids: Record<string, string>;

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  const save = (client: PersonaClient, slug: string, patch: Patch, version = 1) =>
    client.mutation(update, { projectId: ids[slug], expectedContentVersion: version, patch });

  describe("positive", () => {
    it("the owner changes title, description, links and details; the version goes up and the outbox gets a row", async () => {
      const before = await state(ids["fixture-listed"]);
      const r = await save(asA(), "fixture-listed", {
        title: "  Renamed Listed  ",
        description: "New text",
        links: [{ url: "https://example.invalid/repo", label: "Repo", type: "repository" }],
        categoryData: { techStack: ["react", "my-own-thing"], targetAudience: "devs" },
        fieldOrder: ["techStack", "targetAudience"],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.project).toMatchObject({ title: "Renamed Listed", description: "New text", contentVersion: 2, slug: "fixture-listed" });
      expect(r.previousSlug).toBeNull();
      const after = await state(ids["fixture-listed"]);
      expect(after.project).toMatchObject({ title: "Renamed Listed", titleSortKey: "renamed listed", contentVersion: 2, categoryDataVersion: 1 });
      expect(after.project.updatedAt).toBeGreaterThan(before.project.updatedAt);
      expect(after.outbox).toEqual([{ change: "upsert", sourceVersion: 2 }]);
      expect(after.audit).toEqual([]);
      // The public read sees the change.
      expect(await anonymousClient().query(getPublicBySlug, { slug: "fixture-listed" })).toMatchObject({ title: "Renamed Listed" });
    });

    it("tags: deduplicated by nameKey, existing tags reused, new ones created, join and counters rewritten together", async () => {
      const before = await state(ids["fixture-listed"]);
      expect(tagCount(before, "Next.js")).toBeGreaterThan(0);
      const r = await save(asA(), "fixture-listed", { tags: ["react 19", "React 19", "REACT  19", "Rust", "Brand New Tag", "brand new tag"] });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Existing "React 19" keeps its display name; the first spelling names the new tag.
      expect(r.project.tags).toEqual(["React 19", "Rust", "Brand New Tag"]);
      const after = await state(ids["fixture-listed"]);
      expect(after.project.tagCount).toBe(3);
      expect(after.joins.map((j) => j.position)).toEqual([0, 1, 2]);
      expect(after.joins.every((j) => j.listed)).toBe(true);
      expect(after.joins.map((j) => j.tagId)).toEqual(after.project.tagIds);
      expect(tagCount(after, "Next.js")).toBe(tagCount(before, "Next.js")! - 1);
      expect(tagCount(after, "Postgres")).toBe(tagCount(before, "Postgres")! - 1);
      expect(tagCount(after, "Rust")).toBe(tagCount(before, "Rust")! + 1);
      expect(tagCount(after, "React 19")).toBe(tagCount(before, "React 19")! + 1);
      expect(after.tags.filter((t) => t.nameKey === "brand new tag")).toEqual([
        expect.objectContaining({ name: "Brand New Tag", status: "active", listedProjectCount: 1 }),
      ]);
    });

    it("a private project's tag changes don't touch the listed counters", async () => {
      const before = await state(ids["fixture-private"]);
      const r = await save(asA(), "fixture-private", { tags: ["Rust"] });
      expect(r.ok).toBe(true);
      const after = await state(ids["fixture-private"]);
      expect(tagCount(after, "Rust")).toBe(tagCount(before, "Rust"));
      expect(tagCount(after, "Next.js")).toBe(tagCount(before, "Next.js"));
      expect(after.joins.every((j) => !j.listed)).toBe(true);
      expect(after.outbox).toEqual([{ change: "remove", sourceVersion: 2 }]);
    });

    it("slug history: the old slug becomes previous, redirects, stays reserved, and can be taken back", async () => {
      const id = ids["fixture-listed"];
      const r1 = await save(asA(), "fixture-listed", { slug: "fixture-listed-renamed" });
      expect(r1).toMatchObject({ ok: true, previousSlug: "fixture-listed", project: { slug: "fixture-listed-renamed" } });
      let s = await state(id);
      expect(s.slugs).toEqual([
        { slug: "fixture-listed", state: "previous" },
        { slug: "fixture-listed-renamed", state: "current" },
      ]);
      expect(s.audit).toEqual([{ kind: "slug.changed", actorId: expect.any(String), details: { from: "fixture-listed", to: "fixture-listed-renamed" } }]);
      expect(await anonymousClient().query(currentSlug, { slug: "fixture-listed" })).toBe("fixture-listed-renamed");
      expect(await anonymousClient().query(getPublicBySlug, { slug: "fixture-listed" })).toBeNull();

      // B can't take A's old slug.
      const taken = await clientAs(B.subject!).mutation(update, { projectId: ids["fixture-bob-project"], expectedContentVersion: 1, patch: { slug: "fixture-listed" } });
      expect(taken).toMatchObject({ ok: false, code: "invalid", issues: [{ field: "slug" }] });

      // A takes it back: the same row flips, no duplicate.
      const r2 = await save(asA(), "fixture-listed", { slug: "fixture-listed" }, 2);
      expect(r2.ok).toBe(true);
      s = await state(id);
      expect(s.slugs).toEqual([
        { slug: "fixture-listed", state: "current" },
        { slug: "fixture-listed-renamed", state: "previous" },
      ]);
      expect(await anonymousClient().query(currentSlug, { slug: "fixture-listed-renamed" })).toBe("fixture-listed");
    });

    it("the fixture's existing slug history: the old slug redirects; a current slug or an unknown one gives null", async () => {
      expect(await anonymousClient().query(currentSlug, { slug: "fixture-slug-old" })).toBe("fixture-slug-new");
      expect(await anonymousClient().query(currentSlug, { slug: "fixture-slug-new" })).toBeNull();
      expect(await anonymousClient().query(currentSlug, { slug: "nope" })).toBeNull();
    });

    it("an old slug of a private project redirects only for its owner", async () => {
      expect((await save(asA(), "fixture-private", { slug: "fixture-private-2" })).ok).toBe(true);
      expect(await anonymousClient().query(currentSlug, { slug: "fixture-private" })).toBeNull();
      expect(await clientAs(B.subject!).query(currentSlug, { slug: "fixture-private" })).toBeNull();
      expect(await asA().query(currentSlug, { slug: "fixture-private" })).toBe("fixture-private-2");
    });

    it("getMineForEdit: the owner gets the edit view with contentVersion and their own subject; nobody else gets anything", async () => {
      const mine = await asA().query(getMineForEdit, { slug: "fixture-listed" });
      // D08g4c: the caller's token subject is its Better Auth user ID.
      expect(mine).toMatchObject({ id: ids["fixture-listed"], contentVersion: 1, viewerAuthSubject: await personaAuthUserId(A.subject!), tags: ["Next.js", "Postgres"] });
      const text = JSON.stringify(mine);
      expect(text).not.toMatch(/@synthetic\.invalid|"role"|"tier"|ownerId|"userId"/);
      expect(text).not.toContain(B.subject!);
      for (const c of [anonymousClient(), clientAs(B.subject!), clientAs(admin.subject!), clientAs(deleting.subject!), clientAs("user_fixture_unlinked")]) {
        expect(await c.query(getMineForEdit, { slug: "fixture-listed" })).toBeNull();
      }
      expect(mine?.deletedAt).toBeNull();
    });

    it("D08g4f3: the owner also gets their own project in the graveyard, marked deleted; nobody else does, and saving it is refused", async () => {
      const deleted = await asA().query(getMineForEdit, { slug: "fixture-deleted-recent" });
      expect(deleted).toMatchObject({ id: ids["fixture-deleted-recent"], slug: "fixture-deleted-recent" });
      expect(deleted?.deletedAt).toEqual(expect.any(String));
      for (const c of [anonymousClient(), clientAs(B.subject!), clientAs(admin.subject!), clientAs("user_fixture_unlinked")]) {
        expect(await c.query(getMineForEdit, { slug: "fixture-deleted-recent" })).toBeNull();
      }
      const before = await state(ids["fixture-deleted-recent"]);
      expect(await save(asA(), "fixture-deleted-recent", { title: "Edited in the graveyard" })).toEqual({ ok: false, code: "not_found" });
      expect(await state(ids["fixture-deleted-recent"])).toEqual(before);
    });
  });

  describe("negative: nothing is written", () => {
    const unchanged = async (slug: string, run: () => Promise<unknown>) => {
      const before = await state(ids[slug]);
      const result = await run();
      expect(await state(ids[slug])).toEqual(before);
      return result;
    };

    it("anonymous, B, admin (not the owner), deleting and unlinked callers get not_found", async () => {
      for (const c of [anonymousClient(), clientAs(B.subject!), clientAs(admin.subject!), clientAs(deleting.subject!), clientAs("user_fixture_unlinked")]) {
        const r = await unchanged("fixture-listed", () => save(c, "fixture-listed", { title: "Hijacked" }));
        expect(r).toEqual({ ok: false, code: "not_found" });
      }
    });

    it("a deleted project, a malformed ID and another table's ID look the same as someone else's project", async () => {
      expect(await unchanged("fixture-deleted-recent", () => save(asA(), "fixture-deleted-recent", { title: "Back" }))).toEqual({ ok: false, code: "not_found" });
      for (const projectId of ["not-an-id", "", otherLastChar(ids["fixture-listed"])]) {
        expect(await asA().mutation(update, { projectId, expectedContentVersion: 1, patch: { title: "x" } })).toEqual({ ok: false, code: "not_found" });
      }
    });

    it("stale edit: a save with an old contentVersion is refused after another save went through", async () => {
      expect((await save(asA(), "fixture-listed", { title: "First" })).ok).toBe(true);
      const r = await unchanged("fixture-listed", () => save(asA(), "fixture-listed", { title: "Second, from an old tab" }, 1));
      expect(r).toEqual({ ok: false, code: "stale", contentVersion: 2 });
    });

    it.each([
      ["ownerId", { ownerId: "x" }],
      ["status", { status: "deleted" }],
      ["visibility", { visibility: "private" }],
      ["listed", { listed: false }],
      ["favoriteCount", { favoriteCount: 999 }],
      ["rankingFavoriteCount", { rankingFavoriteCount: 999 }],
      ["contentVersion", { contentVersion: 99 }],
      ["tagIds", { tagIds: [] }],
      ["createdAt", { createdAt: 0 }],
      ["deletedAt", { deletedAt: 1 }],
      ["user_id", { user_id: B.subject }],
    ])("forbidden field %s is refused by the validator", async (_name, extra) => {
      await unchanged("fixture-listed", async () => {
        await expect(save(asA(), "fixture-listed", { title: "ok", ...extra })).rejects.toThrow(/validator|extra field|Object contains extra field/i);
      });
    });

    it("an extra top-level argument (an identity) is refused too", async () => {
      await unchanged("fixture-listed", async () => {
        await expect(
          asA().mutation(update, { projectId: ids["fixture-listed"], expectedContentVersion: 1, patch: {}, userId: "x" } as unknown as Args),
        ).rejects.toThrow();
      });
    });

    it.each([
      ["javascript: link", { links: [{ url: "javascript:alert(1)", type: "demo" }] }, "url_links"],
      ["data: link", { links: [{ url: "data:text/html,<script>alert(1)</script>" }] }, "url_links"],
      ["relative link", { links: [{ url: "/somewhere" }] }, "url_links"],
      ["11 links", { links: Array.from({ length: 11 }, (_, i) => ({ url: `https://l${i}.invalid/` })) }, "url_links"],
      ["unknown link type", { links: [{ url: "https://x.invalid/", type: "evil" }] }, "url_links"],
      ["16 distinct tags", { tags: Array.from({ length: 16 }, (_, i) => `tag ${i}`) }, "tags"],
      ["a 51-char tag", { tags: ["x".repeat(51)] }, "tags"],
      ["empty title", { title: "   " }, "title"],
      ["bad slug", { slug: "Not A Slug" }, "slug"],
      ["unknown category", { category: "made-up" }, "category"],
      ["unknown details field", { categoryData: { notAField: "x" } }, "category_data"],
      ["wrongly typed details", { categoryData: { techStack: "react" } }, "category_data"],
      ["javascript: in a url field", { category: "mobile", categoryData: { appStoreUrl: "javascript:alert(1)" } }, "category_data"],
      ["oversize details", { categoryData: { techStack: Array.from({ length: 50 }, (_, i) => `${i}`.padEnd(400, "x")) } }, "category_data"],
      ["unknown field in the order", { fieldOrder: ["notAField"] }, "field_order"],
    ])("%s is invalid", async (_name, patch, field) => {
      const r = await unchanged("fixture-listed", () => save(asA(), "fixture-listed", patch));
      expect(r).toMatchObject({ ok: false, code: "invalid" });
      expect((r as { issues: { field: string }[] }).issues.map((i) => i.field)).toContain(field);
    });

    it("a category change whose stored details don't fit the new category is refused", async () => {
      expect((await save(asA(), "fixture-listed", { category: "mobile", categoryData: { appStoreUrl: "https://ok.invalid/" } })).ok).toBe(true);
      const r = await unchanged("fixture-listed", () => save(asA(), "fixture-listed", { category: "security" }, 2));
      expect(r).toMatchObject({ ok: false, code: "invalid", issues: [{ field: "category_data" }] });
    });

    it("atomic: one bad field refuses the whole patch, tags and slug included", async () => {
      const r = await unchanged("fixture-listed", () =>
        save(asA(), "fixture-listed", { title: "Fine", slug: "fixture-listed-x", tags: ["Brand New Tag"], links: [{ url: "javascript:x" }] }),
      );
      expect(r).toMatchObject({ ok: false, code: "invalid" });
      const s = await state(ids["fixture-listed"]);
      expect(s.tags.some((t) => t.nameKey === "brand new tag")).toBe(false);
    });
  });

  it("a real Better Auth login gets nothing until it is linked to A, then edits as A", async () => {
    const email = syntheticEmail("d02-update");
    const res = await signUp(email, SYNTHETIC_PASSWORD);
    expect(res.status).toBe(200);
    const a = { jar: res.jar, authUserId: (await authState(email))!.authUserId };
    const token = (await convexToken(a.jar))!;
    expect(await save(clientWithToken(token), "fixture-listed", { title: "Before link" })).toEqual({ ok: false, code: "not_found" });
    await linkPersona(A.subject!, a.authUserId);
    forgetPersonaLogins();
    const fresh = (await convexToken(a.jar))!;
    const mine = await clientWithToken(fresh).query(getMineForEdit, { slug: "fixture-listed" });
    expect(mine?.viewerAuthSubject).toBe(a.authUserId);
    const r = await save(clientWithToken(fresh), "fixture-listed", { title: "After link" });
    expect(r).toMatchObject({ ok: true, project: { title: "After link" } });
  });
});
