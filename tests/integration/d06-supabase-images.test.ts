// D06-a: the image actions after the containment, against the isolated test
// database. E03: the Supabase registration, client storage and reads are gone;
// what is left checks that the old callable exports stay gone and that no
// image is read from Supabase without Convex. R11, R12 and R33 are covered on
// Convex (d06-convex-images).
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { TEST_SUPABASE_URL } from "../support/isolation";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed"); // A's, with the fixture images
const deletedRecent = project("deletedRecent"); // A's, soft-deleted

const publicUrl = (path: string) => `${TEST_SUPABASE_URL}/storage/v1/object/public/project-images/${path}`;

describe.skipIf(!testDbAvailable())("D06-a Supabase images", () => {
  let sql: postgres.Sql;
  let actions: typeof import("../../src/app/actions/project-images.js");

  const insertImage = async (projectId: string, key: string, order = 0) =>
    (
      await sql`insert into project_images (project_id, storage_path, storage_url, file_name, image_type, display_order, uploaded_by)
        values (${projectId}, ${`fixtures/${key}.png`}, ${publicUrl(`fixtures/${key}.png`)}, ${`${key}.png`}, 'screenshot', ${order}, ${B.subject!})
        returning id`
    )[0].id as string;

  beforeAll(async () => {
    sql = await connectTestDb();
    actions = await import("../../src/app/actions/project-images.js");
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

  // R11 ("registering B's file and replacing it can't delete B's file") tested the
  // Supabase registration path and its client-side storage delete, both gone in
  // E03; d06-convex-images covers R11 on Convex (an attached file can't be taken over).

  it("the unvalidated update and the unused count read are no longer callable", () => {
    expect((actions as Record<string, unknown>).updateProjectImageAction).toBeUndefined();
    expect((actions as Record<string, unknown>).getImageCountAction).toBeUndefined();
  });

  // E03: image reads are Convex-only (d06-convex-images: a listed project's
  // images for anyone, a deleted project's only for its owner). Without a
  // local Convex nobody gets a Supabase image row, the owner included.
  it("without Convex no image is read from Supabase, for anyone", async () => {
    const hidden = await insertImage(deletedRecent.id, "deleted-project-shot");
    await sql`update project_images set image_type = 'cover' where id = ${hidden}`;
    for (const who of [null, B.subject!, A.subject!]) {
      signInAs(who);
      for (const id of [deletedRecent.id, listed.id]) {
        expect(await actions.getProjectImagesAction(id)).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
        expect(await actions.getProjectCoverImageAction(id)).toEqual({ success: true, data: null });
      }
    }
  });

});
