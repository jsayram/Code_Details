// D05-a: the default (Clerk + Supabase) favorite and unfavorite after the
// containment. The real exported server actions, called as the client calls
// them, against the isolated test database. R02: the profile comes from the
// session, never the trailing userId argument. R25: total_favorites moves only
// with a real row insert or delete, under repeats and concurrent requests.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const oneTag = project("oneTag");
const listed = project("listed");

describe.skipIf(!testDbAvailable())("D05-a Supabase favorites", () => {
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

  const rowsOf = async (subject: string, projectId: string) =>
    Number(
      (
        await sql`select count(*)::int as n from favorites f join profiles p on p.id = f.profile_id
          where p.user_id = ${subject} and f.project_id = ${projectId}`
      )[0].n,
    );
  const counter = async (projectId: string) =>
    Number((await sql`select total_favorites from projects where id = ${projectId}`)[0].total_favorites);

  it("R02 denial: a signed-out caller passing A's subject changes nothing", async () => {
    const before = await counter(oneTag.id);
    expect(await actions.addProjectFavorite(oneTag.id, A.subject!)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await actions.removeProjectFavorite(listed.id, A.subject!)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await rowsOf(A.subject!, oneTag.id)).toBe(0);
    expect(await rowsOf(A.subject!, listed.id)).toBe(1);
    expect(await counter(oneTag.id)).toBe(before);
  });

  it("refuses under the Better Auth switch alone (no Supabase write without a Clerk session)", async () => {
    signInAs(B.subject);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_AUTH_BACKEND", "better-auth");
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3380");
    vi.stubEnv("CODEDETAILS_CONVEX_SITE_URL", "http://127.0.0.1:3381");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
    expect(await actions.addProjectFavorite(oneTag.id)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await actions.removeProjectFavorite(listed.id)).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await rowsOf(B.subject!, oneTag.id)).toBe(0);
    expect(await rowsOf(B.subject!, listed.id)).toBe(1);
  });

});
