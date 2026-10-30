// D02-a: the default (Clerk + Supabase) project update after the containment.
// The real exported server action, called as the client calls it, against the
// isolated test database. R02: identity from the session, never the third
// argument. R03: the unguarded write exports are gone from the "use server"
// module. R27: one transaction, tags deduplicated by nameKey. R29: http(s)
// links only (javascript: was a stored XSS), bounded project details.
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
const listed = set.projects.find((p) => p.case === "listed")!;

describe.skipIf(!testDbAvailable())("D02-a Supabase project update", () => {
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

  const row = async (id = listed.id) =>
    (await sql`select title, user_id, deleted_at, total_favorites, url_links, category_data, category from projects where id = ${id}`)[0];

  it("R02 denial: a signed-out caller passing A's subject is refused; nothing changes", async () => {
    const before = await row();
    const r = await actions.updateProject(listed.id, { title: "Hijacked" }, A.subject);
    expect(r).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await row()).toEqual(before);
  });

  it("R03 denial: the unguarded write exports are no longer exported from the \"use server\" module", async () => {
    const dbActions = (await import("../../src/db/actions.js")) as Record<string, unknown>;
    expect(dbActions.updateProjectServer).toBeUndefined();
    expect(dbActions.isProjectOwner).toBeUndefined();
  });

  it("R27: a failed tag write leaves the project row unchanged (one transaction)", async () => {
    signInAs(A.subject);
    const before = await row();
    // Postgres refuses a NUL byte in text, so this tag insert fails after the project row was updated.
    const r = await actions.updateProject(listed.id, { title: "Half written?", tags: [`${RUNTIME_TAG_PREFIX}nul\u0000tag`] }, A.subject);
    expect(r.success).toBe(false);
    expect(await row()).toEqual(before);
  });

  it("no mixed-provider writes: under the Better Auth switch with the Supabase read, nothing is written", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_AUTH_BACKEND", "better-auth");
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3350");
    vi.stubEnv("CODEDETAILS_CONVEX_SITE_URL", "http://127.0.0.1:3351");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
    signInAs(A.subject);
    const before = await row();
    const r = await actions.updateProject(listed.id, { title: "Mixed?" }, A.subject);
    expect(r).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await row()).toEqual(before);
  });
});
