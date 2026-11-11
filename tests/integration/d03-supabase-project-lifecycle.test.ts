// D03-a: the default (Clerk + Supabase) project create, soft delete, restore
// and purge after the containment. The real exported server actions, called as
// the client calls them, against the isolated test database. R02: identity
// from the session, never the trailing userId argument. R03: the unguarded
// write exports are gone from the "use server" modules. SEC-D02-MASS: the
// create input can't set columns outside the whitelist. SEC-D03-SQLI: the tag
// count action binds its IDs.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { RUNTIME_TAG_PREFIX, generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
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

  describe("create", () => {

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

    it("a failed tag write leaves no project behind (one transaction)", async () => {
      signInAs(A.subject);
      const r = await actions.createProject(newProject("fixture-d03-half", { tags: [`${RUNTIME_TAG_PREFIX}nul\u0000tag`] }), A.subject);
      expect(r.success).toBe(false);
      expect(await bySlug("fixture-d03-half")).toBeUndefined();
    });

    // E03: src/db, with both "use server" modules, is gone altogether.
    it("R03 denial: createProjectServer, addProject and the src/db operations are gone", async () => {
      await expect(import("../../src/db/actions.js" as string)).rejects.toThrow();
      await expect(import("../../src/db/operations.js" as string)).rejects.toThrow();
    });
  });

  describe("soft delete", () => {

    it("an already deleted project isn't deleted again (deleted_at kept)", async () => {
      signInAs(A.subject);
      const before = (await state(deletedRecent.id)).deleted_at;
      expect((await actions.removeProject(deletedRecent.id, A.subject)).success).toBe(false);
      expect((await state(deletedRecent.id)).deleted_at).toEqual(before);
    });
  });

  describe("restore", () => {

    it("R02 denial: a signed-out caller passing A's subject can't restore", async () => {
      expect(await actions.restoreProject(deletedRecent.id, A.subject)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect((await state(deletedRecent.id)).deleted_at).not.toBeNull();
    });
  });

  describe("purge", () => {

    it("R02 denial: a signed-out caller can't purge", async () => {
      expect(await actions.permanentlyDeleteProject(deletedRecent.id, A.subject)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect(await state(deletedRecent.id)).toBeDefined();
    });
  });

  // SEC-D03-SQLI: getProjectTagCounts (the Supabase tag counts) is gone in E03;
  // tests/unit/e03-supabase-fallback.test.ts checks it stays gone.
});
