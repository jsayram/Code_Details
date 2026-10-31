// D06-a: the default (Clerk + Supabase) image actions after the containment.
// The real exported server actions, called as the client calls them, against
// the isolated test database. Storage is stubbed: nothing here reaches a
// bucket, and the stub records which paths the server would have deleted.
// R11: a registration's path must be the caller's own upload for that project,
// and the URL comes from the path. R12: reorder moves only that project's
// images. R33: replacing a logo replaces the logo, never the cover.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { TEST_SUPABASE_URL } from "../support/isolation";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);
const deletedFromStorage = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/supabase-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/supabase-storage")>()),
  deleteProjectImage: async (path: string) => {
    deletedFromStorage.push(path);
    return { success: true };
  },
}));

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed"); // A's, with the fixture images
const ownedByB = project("ownedByB");
const deletedRecent = project("deletedRecent"); // A's, soft-deleted

const FILE = "0b9a3c2e-4f1d-4e8a-9c7b-2d5e6f708192-shot.png";
const pathFor = (subject: string, projectId: string, file = FILE) => `${subject}/${projectId}/${file}`;
const publicUrl = (path: string) => `${TEST_SUPABASE_URL}/storage/v1/object/public/project-images/${path}`;

describe.skipIf(!testDbAvailable())("D06-a Supabase images", () => {
  let sql: postgres.Sql;
  let actions: typeof import("../../src/app/actions/project-images.js");

  const upload = (over: Record<string, unknown> = {}) =>
    actions.createProjectImageAction({
      projectId: listed.id,
      storagePath: pathFor(A.subject!, listed.id),
      storageUrl: "ignored",
      fileName: "shot.png",
      fileSize: 1234,
      mimeType: "image/png",
      width: 800,
      height: 600,
      imageType: "screenshot",
      aspectRatio: "16:9",
      ...over,
    } as Parameters<typeof actions.createProjectImageAction>[0]);

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
    deletedFromStorage.length = 0;
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

  it("R11: registering B's file and replacing it can't delete B's file", async () => {
    signInAs(A.subject);
    const victim = pathFor(B.subject!, ownedByB.id);
    await upload({ storagePath: victim, imageType: "cover" });
    await upload({ imageType: "cover" });
    expect(deletedFromStorage).not.toContain(victim);
  });

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
