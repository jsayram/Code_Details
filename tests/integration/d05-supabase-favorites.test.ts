// D05-a: the default (Clerk + Supabase) favorite and unfavorite after the
// containment. The real exported server actions, called as the client calls
// them, against the isolated test database. R02: the profile comes from the
// session, never the trailing userId argument. R25: total_favorites moves only
// with a real row insert or delete, under repeats and concurrent requests.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const oneTag = project("oneTag");
const listed = project("listed");
const deletedRecent = project("deletedRecent");

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
  const rows = async (projectId: string) =>
    Number((await sql`select count(*)::int as n from favorites where project_id = ${projectId}`)[0].n);
  const counter = async (projectId: string) =>
    Number((await sql`select total_favorites from projects where id = ${projectId}`)[0].total_favorites);

  it("B favorites A's project: one row, counter +1", async () => {
    signInAs(B.subject);
    const before = await counter(oneTag.id);
    expect((await actions.addProjectFavorite(oneTag.id, B.subject!)).success).toBe(true);
    expect(await rowsOf(B.subject!, oneTag.id)).toBe(1);
    expect(await counter(oneTag.id)).toBe(before + 1);
  });

  it("B unfavorites: the row goes, counter -1", async () => {
    signInAs(B.subject);
    const before = await counter(listed.id);
    expect((await actions.removeProjectFavorite(listed.id, B.subject!)).success).toBe(true);
    expect(await rowsOf(B.subject!, listed.id)).toBe(0);
    expect(await counter(listed.id)).toBe(before - 1);
  });

  it("R02 denial: B passing A's subject favorites as B, never as A", async () => {
    signInAs(B.subject);
    expect((await actions.addProjectFavorite(oneTag.id, A.subject!)).success).toBe(true);
    expect(await rowsOf(A.subject!, oneTag.id)).toBe(0);
    expect(await rowsOf(B.subject!, oneTag.id)).toBe(1);
  });

  it("R02 denial: B passing A's subject can't remove A's favorite", async () => {
    signInAs(B.subject);
    const ownedByB = project("ownedByB");
    expect((await actions.removeProjectFavorite(ownedByB.id, A.subject!)).success).toBe(true);
    expect(await rowsOf(A.subject!, ownedByB.id)).toBe(1);
  });

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

  it("a deleted, missing or malformed project can't be favorited", async () => {
    signInAs(A.subject);
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const id of [deletedRecent.id, missing, "not-a-uuid"]) {
      expect(await actions.addProjectFavorite(id)).toMatchObject({ success: false, code: "PROJECT_NOT_FOUND" });
    }
    expect(await rowsOf(A.subject!, deletedRecent.id)).toBe(0);
  });

  it("a favorite on a deleted project can still be removed, and the counter follows", async () => {
    signInAs(B.subject);
    const before = await counter(deletedRecent.id);
    expect((await actions.removeProjectFavorite(deletedRecent.id)).success).toBe(true);
    expect(await rowsOf(B.subject!, deletedRecent.id)).toBe(0);
    expect(await counter(deletedRecent.id)).toBe(Math.max(before - 1, 0));
  });

  it("R25: repeated adds and removes change the counter once each", async () => {
    signInAs(B.subject);
    const before = await counter(oneTag.id);
    for (let i = 0; i < 3; i++) expect((await actions.addProjectFavorite(oneTag.id)).success).toBe(true);
    expect(await counter(oneTag.id)).toBe(before + 1);
    for (let i = 0; i < 3; i++) expect((await actions.removeProjectFavorite(oneTag.id)).success).toBe(true);
    expect(await counter(oneTag.id)).toBe(before);
    expect(await rowsOf(B.subject!, oneTag.id)).toBe(0);
  });

  it("R25: unfavoriting a project you never favorited leaves the counter alone", async () => {
    signInAs(B.subject);
    await sql`update projects set total_favorites = 5 where id = ${oneTag.id}`;
    expect((await actions.removeProjectFavorite(oneTag.id)).success).toBe(true);
    expect(await counter(oneTag.id)).toBe(5);
  });

  it("concurrent: ten simultaneous adds make one row and +1; ten removes make -1", async () => {
    signInAs(B.subject);
    const before = await counter(oneTag.id);
    const adds = await Promise.all(Array.from({ length: 10 }, () => actions.addProjectFavorite(oneTag.id)));
    expect(adds.every((r) => r.success)).toBe(true);
    expect(await rowsOf(B.subject!, oneTag.id)).toBe(1);
    expect(await counter(oneTag.id)).toBe(before + 1);
    const removes = await Promise.all(Array.from({ length: 10 }, () => actions.removeProjectFavorite(oneTag.id)));
    expect(removes.every((r) => r.success)).toBe(true);
    expect(await rowsOf(B.subject!, oneTag.id)).toBe(0);
    expect(await counter(oneTag.id)).toBe(before);
  });

  it("concurrent mixed: the counter equals the rows afterwards", async () => {
    signInAs(B.subject);
    await sql`update projects set total_favorites = (select count(*) from favorites where project_id = ${oneTag.id}) where id = ${oneTag.id}`;
    const ops = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? actions.addProjectFavorite(oneTag.id) : actions.removeProjectFavorite(oneTag.id),
    );
    expect((await Promise.all(ops)).every((r) => r.success)).toBe(true);
    expect(await counter(oneTag.id)).toBe(await rows(oneTag.id));
  });
});
