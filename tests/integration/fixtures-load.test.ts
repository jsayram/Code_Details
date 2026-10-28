import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { countFixtureRows, loadFixtures } from "../fixtures/supabase";

const ROLLBACK = new Error("rollback");

describe.skipIf(!testDbAvailable())("fixtures in the current schema (B09)", () => {
  let sql: Awaited<ReturnType<typeof connectTestDb>>;
  beforeAll(async () => {
    sql = await connectTestDb();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("load the expected records, then roll back", async () => {
    const set = generateFixtures();
    const listed = set.projects.find((p) => p.case === "listed")!;

    await expect(
      sql.begin(async (tx) => {
        await loadFixtures(tx, set);
        expect(await countFixtureRows(tx)).toEqual({
          profiles: 6, // every persona except anonymous and noProfile
          username_history: 1,
          projects: 12, // the purged case is never inserted
          tags: 16,
          project_tags: 26,
          favorites: 4,
          project_images: 5,
          tag_submissions: 1,
        });

        const [row] = await tx<{ total_favorites: string; owner: string }[]>`
          select total_favorites, user_id as owner from projects where id = ${listed.id}`;
        expect(Number(row.total_favorites)).toBe(2);
        expect(row.owner).toBe(set.personas.a.subject);

        const deleted = await tx`select slug from projects where deleted_at is not null order by slug`;
        expect(deleted.map((r) => r.slug)).toEqual(["fixture-deleted-long-ago", "fixture-deleted-recent"]);

        const [unicode] = await tx`select title from projects where slug = 'fixture-unicode'`;
        expect(unicode.title).toBe("Café déjà vu — مرحبا 🚀");

        // tags.name is citext with a unique key, so case variants collapse.
        await expect(tx`insert into tags (name) values ('react 19')`).rejects.toThrow(/duplicate key/);
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);

    expect(Object.values(await countFixtureRows(sql)).every((n) => n === 0)).toBe(true);
  });
});
