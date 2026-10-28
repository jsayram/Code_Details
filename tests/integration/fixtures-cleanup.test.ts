import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { RUNTIME_TAG_PREFIX, generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, countFixtureRows, loadFixtures, publicTableDigest } from "../fixtures/supabase";

// Rows that are not fixtures. Cleanup must leave every one of them alone.
const SENTINEL = {
  subject: "user_sentinel_not_a_fixture",
  profileId: "5e5e5e5e-0000-4000-8000-000000000001",
  projectId: "5e5e5e5e-0000-4000-8000-000000000002",
  tagId: "5e5e5e5e-0000-4000-8000-000000000003",
};

const zero = (counts: Record<string, number>) => Object.values(counts).every((n) => n === 0);

describe.skipIf(!testDbAvailable())("fixture cleanup (B10)", () => {
  let sql: Awaited<ReturnType<typeof connectTestDb>>;
  let pristine: string;

  beforeAll(async () => {
    sql = await connectTestDb();
    await cleanupFixtures(sql); // a crashed earlier run must not break this one
    pristine = await publicTableDigest(sql);
    await sql`insert into profiles (id, user_id, email_address, username) values (${SENTINEL.profileId}, ${SENTINEL.subject}, 'sentinel@keep.invalid', 'sentinel-keep')`;
    await sql`insert into tags (id, name) values (${SENTINEL.tagId}, 'sentinel-keep')`;
    await sql`insert into projects (id, title, slug, user_id) values (${SENTINEL.projectId}, 'Sentinel', 'sentinel-keep', ${SENTINEL.subject})`;
    await sql`insert into project_tags (project_id, tag_id) values (${SENTINEL.projectId}, ${SENTINEL.tagId})`;
    await sql`insert into favorites (profile_id, project_id) values (${SENTINEL.profileId}, ${SENTINEL.projectId})`;
  });

  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql`delete from favorites where profile_id = ${SENTINEL.profileId}`;
    await sql`delete from project_tags where project_id = ${SENTINEL.projectId}`;
    await sql`delete from projects where id = ${SENTINEL.projectId}`;
    await sql`delete from tags where id = ${SENTINEL.tagId}`;
    await sql`delete from profiles where id = ${SENTINEL.profileId}`;
    expect(await publicTableDigest(sql)).toBe(pristine);
    await sql.end();
  });

  it("is a no-op on a database without fixtures", async () => {
    expect(zero(await cleanupFixtures(sql))).toBe(true);
  });

  it("restores the exact pre-load state on every repeat, leaving non-fixture rows intact", async () => {
    const baseline = await publicTableDigest(sql);
    for (let run = 0; run < 3; run++) {
      await loadFixtures(sql, generateFixtures());
      expect(zero(await countFixtureRows(sql))).toBe(false);

      const removed = await cleanupFixtures(sql);
      expect(removed.projects).toBe(12);
      expect(zero(await countFixtureRows(sql))).toBe(true);
      expect(await publicTableDigest(sql)).toBe(baseline);
    }
  });

  it("also removes rows a test created for fixture users", async () => {
    const set = await loadFixtures(sql, generateFixtures());
    const owner = set.personas.b.subject!;
    const projectId = randomUUID();
    const [tag] = await sql`insert into tags (name) values (${RUNTIME_TAG_PREFIX + "runtime-tag"}) returning id`;
    await sql`insert into projects (id, title, slug, user_id) values (${projectId}, 'Runtime', 'runtime-created', ${owner})`;
    await sql`insert into project_tags (project_id, tag_id) values (${projectId}, ${tag.id})`;
    await sql`insert into favorites (profile_id, project_id) values (${SENTINEL.profileId}, ${projectId})`;

    const removed = await cleanupFixtures(sql);
    expect(removed.projects).toBe(13);
    expect(removed.tags).toBe(17);
    expect(zero(await countFixtureRows(sql))).toBe(true);

    const [kept] = await sql`select count(*)::int as n from favorites where profile_id = ${SENTINEL.profileId}`;
    expect(kept.n).toBe(1); // the sentinel's own favorite survives; the one on the runtime project is gone
  });

  it("refuses to load over leftovers instead of mixing runs", async () => {
    await loadFixtures(sql, generateFixtures());
    await expect(loadFixtures(sql, generateFixtures())).rejects.toThrow(/already present/);
    await cleanupFixtures(sql);
  });
});
