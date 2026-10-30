// C03: today's public project read (getProjectBySlugServer and
// getProjectUsersProfileBySlugServer, the two calls the project page made;
// since D02r readProjectBySlug and readProjectOwnerProfileBySlug)
// against synthetic fixtures on the isolated test database. Like B13, these
// assert what the code does now. Defects are named as defects; they are not
// the target behavior, which is the C02 contract in
// src/backend/projects/public-project.ts.
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { fixtureId, generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed");
const tagName = (id: string) => set.tags.find((t) => t.id === id)!.name;

describe.skipIf(!testDbAvailable())("C03 current project read", () => {
  let sql: postgres.Sql;
  // D02r moved both reads out of the "use server" src/db/actions.ts, unchanged
  // apart from taking the viewer as one session-derived value.
  let dbActions: typeof import("../../src/db/project-read.js");

  beforeAll(async () => {
    sql = await connectTestDb();
    dbActions = await import("../../src/db/project-read.js");
  });

  beforeEach(async () => {
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });

  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  it("listed project: returns the row, its tags and the owner's profile fields", async () => {
    const p = await dbActions.readProjectBySlug(listed.slug, null);
    expect(p).not.toBeNull();
    expect(p!.id).toBe(listed.id);
    expect(p!.title).toBe(listed.title);
    expect(p!.description).toBe(listed.description);
    expect(p!.category).toBe("web");
    expect(p!.url_links).toEqual(listed.urlLinks);
    expect([...(p!.tags ?? [])].sort()).toEqual(listed.tagIds.map(tagName).sort());
    expect(p!.created_at).toBeInstanceOf(Date);
    expect((p as Record<string, unknown>).owner_username).toBe(A.profile!.username);
    expect((p as Record<string, unknown>).owner_full_name).toBe(A.profile!.fullName);
  });

  it("defect R07: the anonymous result carries the owner's email, provider subject, profile UUID and tier", async () => {
    const p = (await dbActions.readProjectBySlug(listed.slug, null)) as Record<string, unknown>;
    expect(p.owner_email_address).toBe(A.profile!.email);
    expect(p.owner_user_id).toBe(A.subject);
    expect(p.user_id).toBe(A.subject);
    expect(p.owner_id).toBe(A.profile!.id);
    expect(p.owner_tier).toBe("pro");
    const profile = (await dbActions.readProjectOwnerProfileBySlug(listed.slug)) as Record<string, unknown>;
    expect(profile.email_address).toBe(A.profile!.email);
    expect(profile.user_id).toBe(A.subject);
  });

  it("favorite count comes back as a numeric string (Postgres numeric), which the page prints as-is", async () => {
    const p = await dbActions.readProjectBySlug(listed.slug, null);
    expect(p!.total_favorites).toBe("2");
  });

  it("missing slug returns null", async () => {
    expect(await dbActions.readProjectBySlug("fixture-does-not-exist", null)).toBeNull();
    expect(await dbActions.readProjectOwnerProfileBySlug("fixture-does-not-exist")).toBeNull();
  });

  it("deleted project returns null to an anonymous viewer", async () => {
    for (const c of ["deletedRecent", "deletedLongAgo"]) {
      expect(await dbActions.readProjectBySlug(project(c).slug, null)).toBeNull();
    }
  });

  it("defect: the profile query ignores deleted_at, so it answers for a deleted project (the page hides it by 404ing on the project)", async () => {
    const profile = await dbActions.readProjectOwnerProfileBySlug(project("deletedRecent").slug);
    expect(profile?.username).toBe(A.profile!.username);
  });

  it("gap: the current schema has no visibility, so the 'private' fixture is served like any public project", async () => {
    const p = await dbActions.readProjectBySlug(project("private").slug, null);
    expect(p?.id).toBe(project("private").id);
  });

  it("purged project (never inserted) returns null", async () => {
    expect(await dbActions.readProjectBySlug(project("purged").slug, null)).toBeNull();
  });

  it("no description: description is null and tags are an empty array", async () => {
    const p = await dbActions.readProjectBySlug(project("noDescription").slug, null);
    expect(p!.description).toBeNull();
    expect(p!.tags).toEqual([]);
  });

  it("unicode title and description round-trip unchanged", async () => {
    const u = project("unicode");
    const p = await dbActions.readProjectBySlug(u.slug, null);
    expect(p!.title).toBe(u.title);
    expect(p!.description).toBe(u.description);
  });

  it("defect: tag order is unspecified (the tag query has no ORDER BY); only the set is stable", async () => {
    const f = project("fifteenTags");
    const p = await dbActions.readProjectBySlug(f.slug, null);
    expect(p!.tags).toHaveLength(15);
    expect(new Set(p!.tags)).toEqual(new Set(f.tagIds.map(tagName)));
  });

  it("orphaned project (owner has no profile): project returned with null owner fields, profile query null", async () => {
    const id = fixtureId(set.seed, "c03:orphan");
    await sql`insert into projects (id, user_id, title, slug, category) values (${id}, ${set.personas.noProfile.subject}, 'Fixture Orphan', 'fixture-orphan', 'web')`;
    const p = (await dbActions.readProjectBySlug("fixture-orphan", null)) as Record<string, unknown>;
    expect(p.id).toBe(id);
    expect(p.owner_username).toBeNull();
    expect(p.owner_email_address).toBeNull();
    expect(await dbActions.readProjectOwnerProfileBySlug("fixture-orphan")).toBeNull();
  });

  it("slug lookup is exact: a case variant of a real slug is not found", async () => {
    expect(await dbActions.readProjectBySlug(listed.slug.toUpperCase(), null)).toBeNull();
  });
});
