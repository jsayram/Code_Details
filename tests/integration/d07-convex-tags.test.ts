// D07-b: tags, suggestions, moderation and roles on the task-owned test
// backend (P07 §3.7, §3.8, §3.11, §3.12; P08 R04, R20, R30). Callers come only
// from getViewer (the D01 synthetic issuer for the Clerk-era personas). The
// project's tags are checked as the join, the projects.tagIds copy and the
// listed counters see them, so the one membership writer keeps them together.
import fs from "node:fs";
import path from "node:path";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";

type Issue = { field: string; message: string };
type SuggestResult =
  | { ok: true; status: "already" | "attached" | "pending" }
  | { ok: false; code: "not_found" | "duplicate" | "too_many_pending" }
  | { ok: false; code: "invalid"; issues: Issue[] };
type ModerateResult = { ok: true } | { ok: false; code: "not_found" | "not_pending" | "limit" } | { ok: false; code: "invalid"; issues: Issue[] };
type TagState = {
  project: { tagCount: number; contentVersion: number; updatedAt: number; tags: (string | null)[] } | null;
  joins: { tag: string | null; position: number; listed: boolean }[];
  suggestions: { nameKey: string; status: string; submitter: string | null; reviewer: string | null; adminNotes: string | null }[];
  outbox: { change: string; sourceVersion: number }[];
  counts: Record<string, number>;
};
type Pending = { nameKey: string; count: number; suggestions: { id: string; project: { slug: string } | null; submitterUsername: string | null }[] }[];

const search = makeFunctionReference<"query", { query: string }, { name: string; listedProjectCount: number }[]>("tags:search");
const suggest = makeFunctionReference<"mutation", { projectId: string; name: string; note?: string }, SuggestResult>("tags:suggest");
const mySuggestions = makeFunctionReference<"query", { projectId: string }, { name: string; status: string }[]>("tags:mySuggestions");
const listPending = makeFunctionReference<"query", Record<string, never>, Pending | null>("tags:listPending");
const approve = makeFunctionReference<"mutation", { suggestionId: string; scope: "project" | "system"; adminNotes?: string }, ModerateResult>("tags:approve");
const reject = makeFunctionReference<"mutation", { suggestionId: string; adminNotes?: string }, ModerateResult>("tags:reject");
const whoami = makeFunctionReference<"query", Record<string, never>, { role: string } | null>("identity:whoami");
const tagState = makeFunctionReference<"query", { projectId: string }, TagState>("fixtures:tagState");
const addTagAlias = makeFunctionReference<"mutation", { aliasKey: string; tagNameKey: string; reviewerUsernameKey: string }>("fixtures:addTagAlias");
const setRoleByUsername = makeFunctionReference<"mutation", { usernameKey: string; role: "user" | "admin" }>("fixtures:setRoleByUsername");
const roleAudit = makeFunctionReference<"query", Record<string, never>, { username: string | null; actorId: string | null; details: Record<string, unknown> }[]>("fixtures:roleAudit");
const bootstrapAdmin = makeFunctionReference<"mutation", { username: string }, { changed: boolean }>("roles:bootstrapAdmin");
const setRole = makeFunctionReference<"mutation", { username: string; role: "user" | "admin" }, { changed: boolean }>("roles:setRole");

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const asA = () => clientAs(A.subject!);
const asB = () => clientAs(B.subject!);
const asAdmin = () => clientAs(admin.subject!);
const slug = (c: string) => set.projects.find((p) => p.case === c)!.slug;

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D07 Convex tags and suggestions", () => {
  let ids: Record<string, string>;
  const id = (c: string) => ids[slug(c)];
  const state = (c: string) => adminClient().query(tagState, { projectId: id(c) });
  /** The join, the copy and the count agree. */
  const consistent = (s: TagState) => {
    expect(s.project!.tags).toEqual(s.joins.map((j) => j.tag));
    expect(s.joins.map((j) => j.position)).toEqual(s.joins.map((_, i) => i));
    expect(s.project!.tagCount).toBe(s.joins.length);
  };
  const pendingIds = async (nameKey: string) =>
    ((await asAdmin().query(listPending, {})) ?? []).filter((g) => g.nameKey === nameKey).flatMap((g) => g.suggestions.map((s) => s.id));

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  describe("lookup", () => {
    it("is public: a prefix finds active tags by nameKey; an empty query gives the most used", async () => {
      const found = await anonymousClient().query(search, { query: "NE" });
      expect(found.map((t) => t.name)).toContain("Next.js");
      expect(found.every((t) => t.name.toLowerCase().startsWith("ne"))).toBe(true);
      const top = await anonymousClient().query(search, { query: "" });
      expect(top.length).toBeGreaterThan(0);
      expect(top.map((t) => t.listedProjectCount)).toEqual([...top.map((t) => t.listedProjectCount)].sort((x, y) => y - x));
    });
  });

  describe("suggest", () => {
    it("signed out: not_found, nothing written", async () => {
      const before = await state("listed");
      expect(await anonymousClient().mutation(suggest, { projectId: id("listed"), name: "rust" })).toEqual({ ok: false, code: "not_found" });
      expect(await state("listed")).toEqual(before);
    });

    it("a non-owner's existing tag stays pending under their own account; a repeat is a duplicate", async () => {
      const before = await state("listed");
      expect(await asB().mutation(suggest, { projectId: id("listed"), name: "  RUST " })).toEqual({ ok: true, status: "pending" });
      const after = await state("listed");
      expect(after.joins).toEqual(before.joins);
      expect(after.project).toEqual(before.project);
      expect(after.suggestions).toEqual([...before.suggestions, { nameKey: "rust", status: "pending", submitter: "fixture-bob", reviewer: null, adminNotes: null }]);
      expect(await asB().mutation(suggest, { projectId: id("listed"), name: "Rust" })).toEqual({ ok: false, code: "duplicate" });
    });

    it("the owner attaches an existing tag: join, copy and counter together, content version and outbox move", async () => {
      const before = await state("listed");
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "Rust" })).toEqual({ ok: true, status: "attached" });
      const after = await state("listed");
      consistent(after);
      expect(after.project!.tags).toEqual([...before.project!.tags, "rust"]);
      expect(after.counts.rust).toBe(before.counts.rust + 1);
      expect(after.project!.contentVersion).toBe(before.project!.contentVersion + 1);
      expect(after.project!.updatedAt).toBe(before.project!.updatedAt);
      expect(after.outbox).toEqual([...before.outbox, { change: "upsert", sourceVersion: before.project!.contentVersion + 1 }]);
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "rust" })).toEqual({ ok: true, status: "already" });
    });

    it("a reviewed alias resolves to its tag", async () => {
      await adminClient().mutation(addTagAlias, { aliasKey: "rustlang", tagNameKey: "rust", reviewerUsernameKey: "fixture-admin" });
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "RustLang" })).toEqual({ ok: true, status: "attached" });
      expect((await state("listed")).project!.tags).toContain("rust");
    });

    it("the owner at the limit is refused; nothing changes", async () => {
      const before = await state("fifteenTags");
      const r = await asA().mutation(suggest, { projectId: id("fifteenTags"), name: "Swift" });
      expect(r).toMatchObject({ ok: false, code: "invalid" });
      expect(await state("fifteenTags")).toEqual(before);
    });

    it("private, deleted and malformed projects look missing to a non-owner; the owner may tag their private project", async () => {
      for (const projectId of [id("private"), id("deletedRecent"), "not-an-id"]) {
        expect(await asB().mutation(suggest, { projectId, name: "rust" })).toEqual({ ok: false, code: "not_found" });
      }
      const before = await state("private");
      expect(await asA().mutation(suggest, { projectId: id("private"), name: "rust" })).toEqual({ ok: true, status: "attached" });
      const after = await state("private");
      consistent(after);
      expect(after.joins.every((j) => !j.listed)).toBe(true);
      expect(after.counts.rust).toBe(before.counts.rust); // not listed: no counter change
      expect(after.outbox.at(-1)).toEqual({ change: "remove", sourceVersion: before.project!.contentVersion + 1 });
    });

    it("a brand-new tag is always pending, even for the owner, and follows the suggestion name rule", async () => {
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "Bad Name!" })).toMatchObject({ ok: false, code: "invalid" });
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "-x-" })).toMatchObject({ ok: false, code: "invalid" });
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "fixture-new-idea", note: "x".repeat(501) })).toMatchObject({ ok: false, code: "invalid" });
      expect(await asA().mutation(suggest, { projectId: id("listed"), name: "fixture-new-idea" })).toEqual({ ok: true, status: "pending" });
      expect((await state("listed")).project!.tags).not.toContain("fixture-new-idea");
    });

    it(`one account holds at most 25 pending suggestions`, async () => {
      for (let i = 0; i < 25; i++) {
        expect(await asB().mutation(suggest, { projectId: id("listed"), name: `fixture-p${i}` })).toEqual({ ok: true, status: "pending" });
      }
      expect(await asB().mutation(suggest, { projectId: id("listed"), name: "fixture-p25" })).toEqual({ ok: false, code: "too_many_pending" });
    });

    it("mySuggestions shows the viewer's own only", async () => {
      await asB().mutation(suggest, { projectId: id("listed"), name: "rust" });
      expect((await asB().query(mySuggestions, { projectId: id("listed") })).map((s) => [s.name, s.status])).toEqual([["Rust", "pending"]]);
      expect(await asA().query(mySuggestions, { projectId: id("listed") })).toEqual([]);
      expect(await anonymousClient().query(mySuggestions, { projectId: id("listed") })).toEqual([]);
    });
  });

  describe("moderation (users.role)", () => {
    it("the pending list: null for a non-admin; grouped, with usernames and no emails, for the admin", async () => {
      await asB().mutation(suggest, { projectId: id("listed"), name: "rust" });
      expect(await asB().query(listPending, {})).toBeNull();
      expect(await anonymousClient().query(listPending, {})).toBeNull();
      const groups = (await asAdmin().query(listPending, {}))!;
      const rust = groups.find((g) => g.nameKey === "rust")!;
      expect(rust.suggestions).toEqual([expect.objectContaining({ project: expect.objectContaining({ slug: slug("listed") }), submitterUsername: "fixture-bob" })]);
      expect(JSON.stringify(groups)).not.toContain("@");
    });

    it("approve: not_found for B; the admin's approval creates and attaches the tag and settles the same tag elsewhere", async () => {
      await asB().mutation(suggest, { projectId: id("listed"), name: "fixture-brand-new" });
      await asA().mutation(suggest, { projectId: id("ownedByB"), name: "fixture-brand-new" });
      const [first] = await pendingIds("fixture-brand-new");
      expect(await asB().mutation(approve, { suggestionId: first, scope: "project" })).toEqual({ ok: false, code: "not_found" });
      expect(await asAdmin().mutation(approve, { suggestionId: first, scope: "project", adminNotes: "fits" })).toEqual({ ok: true });
      for (const c of ["listed", "ownedByB"]) {
        const s = await state(c);
        consistent(s);
        expect(s.project!.tags).toContain("fixture-brand-new");
        expect(s.suggestions.find((x) => x.nameKey === "fixture-brand-new")).toMatchObject({ status: "approved", reviewer: "fixture-admin" });
      }
      expect((await state("listed")).counts["fixture-brand-new"]).toBe(2);
      expect(await asAdmin().mutation(approve, { suggestionId: first, scope: "project" })).toEqual({ ok: false, code: "not_pending" });
    });

    it("approve at the limit: project scope refused, system scope creates the tag without attaching it", async () => {
      await asB().mutation(suggest, { projectId: id("fifteenTags"), name: "fixture-sixteenth" });
      const [sid] = await pendingIds("fixture-sixteenth");
      const before = await state("fifteenTags");
      expect(await asAdmin().mutation(approve, { suggestionId: sid, scope: "project" })).toEqual({ ok: false, code: "limit" });
      expect(await state("fifteenTags")).toEqual(before);
      expect(await asAdmin().mutation(approve, { suggestionId: sid, scope: "system" })).toEqual({ ok: true });
      const after = await state("fifteenTags");
      expect(after.project).toEqual(before.project);
      expect(after.counts["fixture-sixteenth"]).toBe(0);
      expect((await anonymousClient().query(search, { query: "fixture-six" })).map((t) => t.name)).toEqual(["fixture-sixteenth"]);
    });

    it("reject: not_found for B; long notes refused; the admin rejects once", async () => {
      await asB().mutation(suggest, { projectId: id("listed"), name: "rust" });
      const [sid] = await pendingIds("rust");
      expect(await asB().mutation(reject, { suggestionId: sid })).toEqual({ ok: false, code: "not_found" });
      expect(await asAdmin().mutation(reject, { suggestionId: sid, adminNotes: "x".repeat(501) })).toMatchObject({ ok: false, code: "invalid" });
      expect(await asAdmin().mutation(reject, { suggestionId: sid, adminNotes: "no" })).toEqual({ ok: true });
      expect((await state("listed")).suggestions.find((s) => s.nameKey === "rust")).toMatchObject({ status: "rejected", reviewer: "fixture-admin", adminNotes: "no" });
      expect(await asAdmin().mutation(reject, { suggestionId: sid })).toEqual({ ok: false, code: "not_pending" });
      expect(await asAdmin().mutation(reject, { suggestionId: "not-an-id" })).toEqual({ ok: false, code: "not_found" });
    });

    it("a demoted admin can't moderate", async () => {
      await asB().mutation(suggest, { projectId: id("listed"), name: "rust" });
      const [sid] = await pendingIds("rust");
      await adminClient().mutation(setRoleByUsername, { usernameKey: "fixture-admin", role: "user" });
      expect(await asAdmin().mutation(approve, { suggestionId: sid, scope: "project" })).toEqual({ ok: false, code: "not_found" });
      expect(await asAdmin().query(listPending, {})).toBeNull();
    });
  });

  describe("roles", () => {
    it("bootstrap refuses while an admin exists; with none it grants one, audited, and refuses again", async () => {
      await expect(adminClient().mutation(bootstrapAdmin, { username: "fixture-bob" })).rejects.toThrow(/already exists/);
      await adminClient().mutation(setRoleByUsername, { usernameKey: "fixture-admin", role: "user" });
      expect(await adminClient().mutation(bootstrapAdmin, { username: "Fixture-Bob" })).toEqual({ changed: true });
      expect(await asB().query(whoami, {})).toMatchObject({ role: "admin" });
      expect(await adminClient().query(roleAudit, {})).toEqual([{ username: "fixture-bob", actorId: null, details: { from: "user", to: "admin", via: "bootstrap" } }]);
      await expect(adminClient().mutation(bootstrapAdmin, { username: "fixture-alice" })).rejects.toThrow(/already exists/);
      await expect(adminClient().mutation(bootstrapAdmin, { username: "nobody-here" })).rejects.toThrow();
    });

    it("setRole: never removes the last admin; each change is audited", async () => {
      await expect(adminClient().mutation(setRole, { username: "fixture-admin", role: "user" })).rejects.toThrow(/last admin/);
      expect(await adminClient().mutation(setRole, { username: "fixture-alice", role: "admin" })).toEqual({ changed: true });
      expect(await adminClient().mutation(setRole, { username: "fixture-admin", role: "user" })).toEqual({ changed: true });
      expect(await adminClient().mutation(setRole, { username: "fixture-admin", role: "user" })).toEqual({ changed: false });
      expect((await adminClient().query(roleAudit, {})).map((r) => [r.username, r.details.to, r.details.via])).toEqual([
        ["fixture-alice", "admin", "operator"],
        ["fixture-admin", "user", "operator"],
      ]);
    });

    it("no client can call the role mutations, and no public module writes a role", async () => {
      await expect(asAdmin().mutation(setRole, { username: "fixture-bob", role: "admin" })).rejects.toThrow();
      await expect(asB().mutation(bootstrapAdmin, { username: "fixture-bob" })).rejects.toThrow();
      expect(await asB().query(whoami, {})).toMatchObject({ role: "user" });
      // Only roles.ts (internal) and fixtures.ts (internal, test-only) change a role;
      // accounts.ts and importCore.ts create users as "user".
      const dir = path.resolve(__dirname, "../../convex");
      const writers = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".ts"))
        .filter((f) => /patch\([^)]*\{[^}]*\brole\b/.test(fs.readFileSync(path.join(dir, f), "utf8")));
      expect(writers.sort()).toEqual(["fixtures.ts", "roles.ts"]);
    });
  });
});
