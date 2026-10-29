// D02-a: the default (Clerk + Supabase) project update after the containment.
// The real exported server action, called as the client calls it, against the
// isolated test database. R02: identity from the session, never the third
// argument. R03: the unguarded write exports are gone from the "use server"
// module. R27: one transaction, tags deduplicated by nameKey. R29: http(s)
// links only (javascript: was a stored XSS), bounded project details.
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
  const tagNames = async (id = listed.id) =>
    (await sql`select t.name from project_tags pt join tags t on t.id = pt.tag_id where pt.project_id = ${id} order by t.name`).map((r) => r.name);

  it("A edits A's own project from the session", async () => {
    signInAs(A.subject);
    const r = await actions.updateProject(listed.id, { title: "Edited by A" }, A.subject);
    expect(r.success).toBe(true);
    expect((await row()).title).toBe("Edited by A");
  });

  it("R02 denial: B passing A's subject as the third argument is refused; nothing changes", async () => {
    signInAs(B.subject);
    const before = await row();
    const r = await actions.updateProject(listed.id, { title: "Hijacked" }, A.subject);
    expect(r).toMatchObject({ success: false, code: "NOT_OWNER" });
    expect(await row()).toEqual(before);
  });

  it("R02 denial: a signed-out caller passing A's subject is refused; nothing changes", async () => {
    const before = await row();
    const r = await actions.updateProject(listed.id, { title: "Hijacked" }, A.subject);
    expect(r).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await row()).toEqual(before);
  });

  it("A passing B's subject still edits only as A (the argument is ignored)", async () => {
    signInAs(A.subject);
    const bob = set.projects.find((p) => p.case === "ownedByB")!;
    expect(await actions.updateProject(bob.id, { title: "x" }, B.subject)).toMatchObject({ success: false, code: "NOT_OWNER" });
  });

  it("mass assignment: owner, deletion and favorite columns in the input never reach the row", async () => {
    signInAs(A.subject);
    const before = await row();
    const r = await actions.updateProject(
      listed.id,
      { title: "Still A's", user_id: B.subject, deleted_at: new Date(), total_favorites: "999" } as never,
      A.subject,
    );
    expect(r.success).toBe(true);
    const after = await row();
    expect(after).toMatchObject({ title: "Still A's", user_id: before.user_id, deleted_at: null, total_favorites: before.total_favorites });
  });

  it("R03 denial: the unguarded write exports are no longer exported from the \"use server\" module", async () => {
    const dbActions = (await import("../../src/db/actions.js")) as Record<string, unknown>;
    expect(dbActions.updateProjectServer).toBeUndefined();
    expect(dbActions.isProjectOwner).toBeUndefined();
  });

  it("R27: case variants of one tag save as one tag, and a new tag is created once", async () => {
    signInAs(A.subject);
    const fresh = `${RUNTIME_TAG_PREFIX}d02 new`;
    const r = await actions.updateProject(listed.id, { tags: ["React 19", "react 19", "REACT 19", fresh, fresh.toUpperCase()] }, A.subject);
    expect(r.success).toBe(true);
    expect((await tagNames()).sort()).toEqual(["React 19", fresh].sort());
  });

  it("R27: a failed tag write leaves the project row unchanged (one transaction)", async () => {
    signInAs(A.subject);
    const before = await row();
    // Postgres refuses a NUL byte in text, so this tag insert fails after the project row was updated.
    const r = await actions.updateProject(listed.id, { title: "Half written?", tags: [`${RUNTIME_TAG_PREFIX}nul\u0000tag`] }, A.subject);
    expect(r.success).toBe(false);
    expect(await row()).toEqual(before);
  });

  it.each([
    ["javascript:", "javascript:alert(document.cookie)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
  ])("R29/XSS: a %s project link is refused; nothing changes", async (_scheme, url) => {
    signInAs(A.subject);
    const before = await row();
    const r = await actions.updateProject(listed.id, { url_links: [{ type: "demo", url }] } as never, A.subject);
    expect(r).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(await row()).toEqual(before);
  });

  it("R29/XSS: a javascript: URL in a url-type details field is refused", async () => {
    signInAs(A.subject);
    const r = await actions.updateProject(
      listed.id,
      { category: "mobile", category_data: { appStoreUrl: "javascript:alert(1)" } } as never,
      A.subject,
    );
    expect(r).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
  });

  it("R29: oversize details are refused; unknown detail keys are still accepted on Supabase", async () => {
    signInAs(A.subject);
    const big = await actions.updateProject(listed.id, { category_data: { notes: "x".repeat(17 * 1024) } } as never, A.subject);
    expect(big).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    const legacy = await actions.updateProject(listed.id, { category_data: { someOldField: "kept" } } as never, A.subject);
    expect(legacy.success).toBe(true);
  });

  it("http and https links still save", async () => {
    signInAs(A.subject);
    const links = [{ type: "repository", url: "https://repo.synthetic.invalid/x" }, { type: "demo", url: "http://demo.synthetic.invalid/" }];
    expect((await actions.updateProject(listed.id, { url_links: links } as never, A.subject)).success).toBe(true);
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
