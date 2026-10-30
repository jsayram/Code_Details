// D06-a2: the public.project_images row-level policies (P08 R10, table part).
// The migration and its rollback run inside a transaction on the slot's test
// database as the table owner and are always rolled back, so the slot keeps the
// captured policies for every other test. The anon and authenticated roles are
// what PostgREST uses for anyone holding the browser's anon key.
import fs from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

const ROOT = path.resolve(__dirname, "../..");
const UP = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261030000000_d06_project_images_rls.sql"), "utf8");
const DOWN = fs.readFileSync(path.join(ROOT, "supabase/rollbacks/20261030000000_d06_project_images_rls.down.sql"), "utf8");

const set = generateFixtures();
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed");
const deletedRecent = project("deletedRecent");
const image = (key: string) => set.images.find((i) => i.storagePath === `fixtures/${key}.png`)!;

class Rollback extends Error {}

describe.skipIf(!testDbAvailable())("D06-a2 project_images policies", () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;

  // Runs `body` in a transaction as the owner, then rolls everything back.
  const inRolledBack = async (body: (tx: postgres.TransactionSql) => Promise<void>) => {
    await owner
      .begin(async (tx) => {
        await body(tx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };
  const policies = async (tx: postgres.Sql | postgres.TransactionSql) =>
    (
      await tx`select policyname, permissive, roles::text, cmd, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = 'project_images' order by policyname`
    ).map((r) => ({ ...r }));
  const asRole = async <T>(tx: postgres.TransactionSql, role: string, body: () => Promise<T>) => {
    await tx.unsafe(`savepoint as_role; set local role ${role}`);
    try {
      return await body();
    } finally {
      await tx.unsafe("rollback to savepoint as_role");
    }
  };
  const count = async (tx: postgres.TransactionSql) =>
    Number((await tx`select count(*)::int as n from project_images where project_id = ${listed.id}`)[0].n);

  beforeAll(async () => {
    sql = await connectTestDb();
    owner = await connectTestDb({ owner: true });
  });
  beforeEach(async () => {
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
    await owner.end();
  });

  it("before the migration (the R10 hole): anon deletes and rewrites image rows", async () => {
    await inRolledBack(async (tx) => {
      const deleted = await asRole(tx, "anon", async () => (await tx`delete from project_images where project_id = ${listed.id} returning id`).length);
      expect(deleted).toBeGreaterThan(0);
    });
  });

  for (const role of ["anon", "authenticated"]) {
    it(`after the migration, ${role} can't insert, update or delete`, async () => {
      await inRolledBack(async (tx) => {
        await tx.unsafe(UP);
        const before = await count(tx);
        expect(await asRole(tx, role, async () => (await tx`delete from project_images returning id`).length)).toBe(0);
        expect(
          await asRole(tx, role, async () =>
            (await tx`update project_images set storage_path = 'x/y/z.png', project_id = ${deletedRecent.id} returning id`).length),
        ).toBe(0);
        await expect(
          asRole(tx, role, () =>
            tx`insert into project_images (project_id, storage_path, storage_url, file_name, image_type, uploaded_by)
               values (${listed.id}, 'a/b/c.png', 'https://example.invalid/c.png', 'c.png', 'cover', 'someone')`),
        ).rejects.toThrow(/row-level security/);
        expect(await count(tx)).toBe(before);
        expect((await tx`select storage_path from project_images where id = ${image("cover").id}`)[0].storage_path).toBe("fixtures/cover.png");
      });
    });

    it(`after the migration, ${role} still reads live images of live projects, and only those`, async () => {
      await inRolledBack(async (tx) => {
        const hidden = (
          await tx`insert into project_images (project_id, storage_path, storage_url, file_name, image_type, uploaded_by)
            values (${deletedRecent.id}, 'fixtures/hidden.png', 'https://example.invalid/h.png', 'hidden.png', 'cover', 'fixture')
            returning id`
        )[0].id as string;
        await tx.unsafe(UP);
        const seen = await asRole(tx, role, async () =>
          (await tx`select id from project_images where id = any(${[image("cover").id, image("screenshot-1").id, image("screenshot-deleted").id, hidden]})`).map((r) => r.id));
        expect(seen.sort()).toEqual([image("cover").id, image("screenshot-1").id].sort());
      });
    });
  }

  it("the app's own role (postgres, BYPASSRLS) still writes after the migration", async () => {
    await inRolledBack(async (tx) => {
      await tx.unsafe(UP);
      const n = await asRole(tx, "postgres", async () => {
        await tx`update project_images set display_order = 9 where id = ${image("screenshot-1").id}`;
        return (await tx`delete from project_images where id = ${image("screenshot-2").id} returning id`).length;
      });
      expect(n).toBe(1);
    });
  });

  it("the rollback restores the captured policies exactly", async () => {
    await inRolledBack(async (tx) => {
      const captured = await policies(tx);
      expect(captured.map((p) => p.policyname)).toEqual([
        "Anyone can view project images",
        "Service can delete images",
        "Service can insert images",
        "Service can update images",
      ]);
      await tx.unsafe(UP);
      expect((await policies(tx)).map((p) => p.policyname)).toEqual(["Anyone can view live project images"]);
      await tx.unsafe(DOWN);
      expect(await policies(tx)).toEqual(captured);
    });
  });

  it("the slot keeps the captured policies after these tests", async () => {
    expect((await policies(sql)).map((p) => p.policyname)).toContain("Service can delete images");
  });
});
