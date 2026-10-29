// C06: the Supabase implementation of the public read, checked against the C02
// spec for every fixture on the isolated test database.
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertPublicProject } from "@/backend/projects/public-project";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { fixtureId, generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { expectedPublicProject } from "../support/public-project-spec";

const set = generateFixtures();
const A = set.personas.a;

describe.skipIf(!testDbAvailable())("C06 Supabase public project reader", () => {
  let sql: postgres.Sql;
  let reader: typeof import("../../src/backend/projects/supabase-reader.js").supabaseProjectReader;

  beforeAll(async () => {
    sql = await connectTestDb();
    reader = (await import("../../src/backend/projects/supabase-reader.js")).supabaseProjectReader;
  });

  beforeEach(async () => {
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });

  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  // The current schema can't store visibility, so the private fixture is public on this backend (C03 gap).
  const supabaseCases = set.projects.filter((p) => p.case !== "private");

  it.each(supabaseCases.map((p) => [p.case, p.slug]))("%s matches the C02 spec", async (_case, slug) => {
    const got = await reader.getPublicProjectBySlug(slug);
    const expected = expectedPublicProject(set, slug);
    if (expected === null) {
      expect(got).toBeNull();
      return;
    }
    assertPublicProject(got);
    const { id, ...rest } = got;
    expect(id).toBe(set.projects.find((p) => p.slug === slug)!.id);
    expect(rest).toEqual(expected);
  });

  it("missing slug returns null, like deleted", async () => {
    expect(await reader.getPublicProjectBySlug("fixture-does-not-exist")).toBeNull();
  });

  it("no email, subject, profile UUID or tier anywhere in the result", async () => {
    const text = JSON.stringify(await reader.getPublicProjectBySlug("fixture-listed"));
    expect(text).not.toContain(A.profile!.email);
    expect(text).not.toContain(A.subject!);
    expect(text).not.toContain(A.profile!.id);
    expect(text).not.toContain('"pro"');
  });

  it("email-shaped username: the contract carries only the local part, never the address", async () => {
    const p = set.projects.find((x) => x.case === "ownedByEmailUsername")!;
    const address = set.personas[p.ownerKey].profile!.username;
    const got = await reader.getPublicProjectBySlug(p.slug);
    expect(got!.owner).toEqual({ username: address.split("@")[0], fullName: null, avatarUrl: null });
    expect(JSON.stringify(got)).not.toContain("@");
  });

  it("the contract check still refuses a full address as the username", async () => {
    const got = await reader.getPublicProjectBySlug("fixture-legacy-owner");
    expect(() => assertPublicProject({ ...got, owner: { ...got!.owner!, username: "fixture.legacy@synthetic.invalid" } }))
      .toThrow(/owner\.username contains an email address/);
  });

  it("category fields outside fieldOrder are not public", async () => {
    await sql`update projects set category_data = ${sql.json({ shown: "yes", hidden: "no" })}, field_order = ${sql.json(["shown"])} where slug = 'fixture-listed'`;
    const got = await reader.getPublicProjectBySlug("fixture-listed");
    expect(got!.categoryData).toEqual({ shown: "yes" });
    expect(got!.fieldOrder).toEqual(["shown"]);
  });

  it("orphaned project: owner is null", async () => {
    const id = fixtureId(set.seed, "c06:orphan");
    await sql`insert into projects (id, user_id, title, slug, category) values (${id}, ${set.personas.noProfile.subject}, 'Fixture Orphan', 'fixture-orphan', 'web')`;
    const got = await reader.getPublicProjectBySlug("fixture-orphan");
    expect(got!.owner).toBeNull();
    expect(got!.favoriteCount).toBe(0);
  });
});
