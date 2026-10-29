// D03-a: the default (Clerk + Supabase) project create, soft delete, restore
// and purge after the containment. The real exported server actions, called as
// the client calls them, against the isolated test database. R02: identity
// from the session, never the trailing userId argument. R03: the unguarded
// write exports are gone from the "use server" modules. SEC-D02-MASS: the
// create input can't set columns outside the whitelist. SEC-D03-SQLI: the tag
// count action binds its IDs.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { RUNTIME_TAG_PREFIX, generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed");
const deletedRecent = project("deletedRecent");

const newProject = (slug: string, extra: Record<string, unknown> = {}) =>
  ({ title: "D03 Created", slug, description: "Made by a test.", category: "web", tags: ["Next.js"], url_links: [], ...extra }) as never;

describe.skipIf(!testDbAvailable())("D03-a Supabase project lifecycle", () => {
  let sql: postgres.Sql;
  let actions: typeof import("../../src/app/actions/projects.js");

  beforeAll(async () => {
    sql = await connectTestDb();
    actions = await import("../../src/app/actions/projects.js");
  });
  beforeEach(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  const bySlug = async (slug: string) => (await sql`select * from projects where slug = ${slug}`)[0];
  const state = async (id: string) => (await sql`select deleted_at from projects where id = ${id}`)[0];
  const count = async (table: string, id: string) =>
    Number((await sql`select count(*)::int as n from ${sql(table)} where project_id = ${id}`)[0].n);

  describe("create", () => {
    it("A creates a project owned by the session's user", async () => {
      signInAs(A.subject);
      const r = await actions.createProject(newProject("fixture-d03-created"), A.subject);
      expect(r.success).toBe(true);
      const row = await bySlug("fixture-d03-created");
      expect(row).toMatchObject({ user_id: A.subject, title: "D03 Created", deleted_at: null, total_favorites: "0" });
      expect(await count("project_tags", row.id)).toBe(1);
    });

    it("R02 denial: B passing A's subject creates the project as B, never as A", async () => {
      signInAs(B.subject);
      expect((await actions.createProject(newProject("fixture-d03-as-b"), A.subject)).success).toBe(true);
      expect((await bySlug("fixture-d03-as-b")).user_id).toBe(B.subject);
    });

    it("R02 denial: a signed-out caller passing A's subject creates nothing", async () => {
      const r = await actions.createProject(newProject("fixture-d03-anon"), A.subject);
      expect(r).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect(await bySlug("fixture-d03-anon")).toBeUndefined();
    });

    it("refuses under the Better Auth switch alone (no Supabase write without a Clerk session)", async () => {
      signInAs(A.subject);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("CODEDETAILS_AUTH_BACKEND", "better-auth");
      vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3360");
      vi.stubEnv("CODEDETAILS_CONVEX_SITE_URL", "http://127.0.0.1:3361");
      vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
      const r = await actions.createProject(newProject("fixture-d03-ba"), A.subject);
      expect(r).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect(await bySlug("fixture-d03-ba")).toBeUndefined();
    });

    it("SEC-D02-MASS: owner, deletion, favorite, ID and timestamp columns in the input never reach the row", async () => {
      signInAs(A.subject);
      const forcedId = "00000000-0000-4000-8000-00000000d003";
      const r = await actions.createProject(
        newProject("fixture-d03-mass", {
          id: forcedId,
          user_id: B.subject,
          deleted_at: new Date(),
          total_favorites: "999",
          created_at: new Date("2001-01-01"),
        }),
        A.subject,
      );
      expect(r.success).toBe(true);
      const row = await bySlug("fixture-d03-mass");
      expect(row.id).not.toBe(forcedId);
      expect(row).toMatchObject({ user_id: A.subject, deleted_at: null, total_favorites: "0" });
      expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2001);
    });

    it.each([
      ["javascript:", "javascript:alert(document.cookie)"],
      ["data:", "data:text/html,<script>alert(1)</script>"],
    ])("XSS: a %s link is refused on create", async (_scheme, url) => {
      signInAs(A.subject);
      const r = await actions.createProject(newProject("fixture-d03-xss", { url_links: [{ type: "demo", url }] }), A.subject);
      expect(r).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(await bySlug("fixture-d03-xss")).toBeUndefined();
    });

    it("R27: case-variant tags save as one tag", async () => {
      signInAs(A.subject);
      const fresh = `${RUNTIME_TAG_PREFIX}d03 new`;
      const r = await actions.createProject(newProject("fixture-d03-tags", { tags: [fresh, fresh.toUpperCase(), "Next.js", "next.js"] }), A.subject);
      expect(r.success).toBe(true);
      expect(await count("project_tags", (await bySlug("fixture-d03-tags")).id)).toBe(2);
    });

    it("a failed tag write leaves no project behind (one transaction)", async () => {
      signInAs(A.subject);
      const r = await actions.createProject(newProject("fixture-d03-half", { tags: [`${RUNTIME_TAG_PREFIX}nul\u0000tag`] }), A.subject);
      expect(r.success).toBe(false);
      expect(await bySlug("fixture-d03-half")).toBeUndefined();
    });

    it("R03 denial: createProjectServer and addProject are no longer \"use server\" exports", async () => {
      const dbActions = (await import("../../src/db/actions.js")) as Record<string, unknown>;
      const operations = (await import("../../src/db/operations.js")) as Record<string, unknown>;
      expect(dbActions.createProjectServer).toBeUndefined();
      expect(operations.addProject).toBeUndefined();
    });

    it("R03 denial: src/db/operations.ts is no longer a \"use server\" module (its favorite writes and email-carrying lists aren't callable)", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(`${process.cwd()}/src/db/operations.ts`, "utf8");
      expect(source).not.toMatch(/^\s*["']use server["']/m);
    });
  });

  describe("soft delete", () => {
    it("A soft-deletes A's project", async () => {
      signInAs(A.subject);
      expect((await actions.removeProject(listed.id, A.subject)).success).toBe(true);
      expect((await state(listed.id)).deleted_at).not.toBeNull();
    });

    it("R02 denial: B passing A's subject can't delete A's project", async () => {
      signInAs(B.subject);
      expect(await actions.removeProject(listed.id, A.subject)).toMatchObject({ success: false, code: "NOT_OWNER" });
      expect((await state(listed.id)).deleted_at).toBeNull();
    });

    it("an already deleted project isn't deleted again (deleted_at kept)", async () => {
      signInAs(A.subject);
      const before = (await state(deletedRecent.id)).deleted_at;
      expect((await actions.removeProject(deletedRecent.id, A.subject)).success).toBe(false);
      expect((await state(deletedRecent.id)).deleted_at).toEqual(before);
    });
  });

  describe("restore", () => {
    it("A restores A's deleted project", async () => {
      signInAs(A.subject);
      expect((await actions.restoreProject(deletedRecent.id, A.subject)).success).toBe(true);
      expect((await state(deletedRecent.id)).deleted_at).toBeNull();
    });

    it("restore is refused for an active project (only from deleted)", async () => {
      signInAs(A.subject);
      expect(await actions.restoreProject(listed.id, A.subject)).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    });

    it("R02 denial: a signed-out caller passing A's subject can't restore", async () => {
      expect(await actions.restoreProject(deletedRecent.id, A.subject)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect((await state(deletedRecent.id)).deleted_at).not.toBeNull();
    });
  });

  describe("purge", () => {
    it("A purges A's deleted project; its tags and favorites go with it", async () => {
      signInAs(A.subject);
      expect(await count("favorites", deletedRecent.id)).toBe(1);
      expect((await actions.permanentlyDeleteProject(deletedRecent.id, A.subject)).success).toBe(true);
      expect(await state(deletedRecent.id)).toBeUndefined();
      expect(await count("favorites", deletedRecent.id)).toBe(0);
      expect(await count("project_tags", deletedRecent.id)).toBe(0);
    });

    it("purge is refused for an active project", async () => {
      signInAs(A.subject);
      expect(await actions.permanentlyDeleteProject(listed.id, A.subject)).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(await state(listed.id)).toBeDefined();
    });

    it("R02 denial: B passing A's subject can't purge A's deleted project", async () => {
      signInAs(B.subject);
      expect(await actions.permanentlyDeleteProject(deletedRecent.id, A.subject)).toMatchObject({ success: false, code: "NOT_OWNER" });
      expect(await state(deletedRecent.id)).toBeDefined();
    });

    it("R02 denial: a signed-out caller can't purge", async () => {
      expect(await actions.permanentlyDeleteProject(deletedRecent.id, A.subject)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect(await state(deletedRecent.id)).toBeDefined();
    });
  });

  describe("SEC-D03-SQLI getProjectTagCounts", () => {
    it("counts tags for real IDs", async () => {
      expect(await actions.getProjectTagCounts([listed.id])).toEqual({ [listed.id]: 2 });
    });

    it("an injected ID is dropped, not run", async () => {
      const injected = `${listed.id}') or 1=1; delete from project_tags where project_id = '${listed.id}' --`;
      const counts = await actions.getProjectTagCounts([injected, "') union select 1 --"]);
      expect(counts).toEqual({});
      expect(await count("project_tags", listed.id)).toBe(2);
    });
  });
});
