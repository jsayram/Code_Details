// D08g4f2: the Clerk-keyed Supabase writes are gone. With the Supabase read
// (no Convex write path), every write action refuses even the signed-in owner,
// and the database is unchanged: projects (create, update, soft delete,
// restore, purge), favorites, images (begin upload, register, set cover,
// delete, purge, reorder) and tag suggestions. The session comes from
// sessionDouble (src/lib/auth-server's session reads); writes went to Convex
// before this slice whenever the login was Better Auth, and still do.
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed"); // A's, with the fixture images
const deletedRecent = project("deletedRecent"); // A's, soft-deleted
const ownedByB = project("ownedByB");

describe.skipIf(!testDbAvailable())("D08g4f2: Supabase writes refuse even the owner", () => {
  let sql: postgres.Sql;
  let projects: typeof import("../../src/app/actions/projects.js");
  let images: typeof import("../../src/app/actions/project-images.js");
  let tags: typeof import("../../src/app/actions/tag-submissions.js");

  /** Every table these actions could touch, as text, so any change shows. */
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all([
        sql`select id, title, slug, description, url_links, deleted_at, total_favorites, user_id from projects order by id`,
        sql`select profile_id, project_id from favorites order by profile_id, project_id`,
        sql`select * from project_images order by id`,
        sql`select project_id, tag_id from project_tags order by project_id, tag_id`,
        sql`select id, name from tags order by id`,
        sql`select id, tag_name, project_id, status from tag_submissions order by id`,
      ]),
    );

  beforeAll(async () => {
    sql = await connectTestDb();
    projects = await import("../../src/app/actions/projects.js");
    images = await import("../../src/app/actions/project-images.js");
    tags = await import("../../src/app/actions/tag-submissions.js");
  });
  beforeEach(async () => {
    signInAs(A.subject);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  it("project writes", async () => {
    const before = await snapshot();
    const refused = { success: false, code: "UNAUTHORIZED" };
    expect(await projects.createProject({ title: "D08g4f2", slug: "fixture-g4f2-new", category: "web", tags: [] } as never, A.subject)).toMatchObject(refused);
    expect(await projects.updateProject(listed.id, { title: "changed" }, A.subject)).toMatchObject(refused);
    expect(await projects.removeProject(listed.id, A.subject)).toMatchObject(refused);
    expect(await projects.restoreProject(deletedRecent.id, A.subject)).toMatchObject(refused);
    expect(await projects.permanentlyDeleteProject(deletedRecent.id, A.subject)).toMatchObject(refused);
    expect(await projects.addProjectFavorite(ownedByB.id, A.subject)).toMatchObject(refused);
    expect(await projects.removeProjectFavorite(ownedByB.id, A.subject)).toMatchObject(refused);
    expect(await snapshot()).toBe(before);
  });

  it("image writes", async () => {
    const [image] = await sql`select id from project_images where project_id = ${listed.id} order by display_order limit 1`;
    const before = await snapshot();
    const refused = { success: false, code: "UNAUTHORIZED" };
    expect(await images.beginProjectImageUploadAction(listed.id, "screenshot")).toMatchObject(refused);
    expect(
      await images.createProjectImageAction({
        projectId: listed.id,
        storageId: "kg2fixturestorageid",
        fileName: "shot.png",
        fileSize: 1234,
        mimeType: "image/png",
        imageType: "screenshot",
      }),
    ).toMatchObject(refused);
    expect(await images.setProjectCoverImageAction(image.id)).toMatchObject(refused);
    expect(await images.deleteProjectImageAction(image.id)).toMatchObject(refused);
    expect(await images.permanentlyDeleteProjectImageAction(image.id)).toMatchObject(refused);
    expect(await images.reorderProjectImagesAction(listed.id, [{ imageId: image.id, order: 0 }])).toMatchObject(refused);
    expect(await snapshot()).toBe(before);
  });

  it("tag suggestions", async () => {
    const before = await snapshot();
    expect(await tags.submitNewTag("fixture-g4f2-tag", listed.id)).toEqual({ success: false, error: "You must be signed in to suggest tags" });
    expect(await snapshot()).toBe(before);
  });
});
