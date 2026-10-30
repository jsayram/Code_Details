// D06-a: the default (Clerk + Supabase) image actions after the containment.
// The real exported server actions, called as the client calls them, against
// the isolated test database. Storage is stubbed: nothing here reaches a
// bucket, and the stub records which paths the server would have deleted.
// R11: a registration's path must be the caller's own upload for that project,
// and the URL comes from the path. R12: reorder moves only that project's
// images. R33: replacing a logo replaces the logo, never the cover.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { TEST_SUPABASE_URL } from "../support/isolation";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
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
const image = (key: string) => set.images.find((i) => i.storagePath === `fixtures/${key}.png`)!;

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

  const imageRow = async (id: string) => (await sql`select * from project_images where id = ${id}`)[0];
  const rowsAt = async (path: string) =>
    Number((await sql`select count(*)::int as n from project_images where storage_path = ${path}`)[0].n);
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

  it("the owner registers an upload; the URL is derived from the path, not the client's", async () => {
    signInAs(A.subject);
    const result = await upload({ storageUrl: "https://attacker.example/x.png" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await imageRow(result.data.id);
    expect(row.storage_url).toBe(publicUrl(pathFor(A.subject!, listed.id)));
    expect(row.uploaded_by).toBe(A.subject);
    expect(row.project_id).toBe(listed.id);
  });

  it("R11: a path outside the caller's own folder for this project is refused", async () => {
    signInAs(A.subject);
    const bad = [
      pathFor(B.subject!, ownedByB.id), // B's file
      pathFor(B.subject!, listed.id), // B's folder, A's project
      pathFor(A.subject!, ownedByB.id), // A's folder, another project
      `${A.subject}/${listed.id}/../../${B.subject}/${ownedByB.id}/${FILE}`,
      `${A.subject}/${listed.id}/sub/${FILE}`,
      "fixtures/cover.png",
    ];
    for (const storagePath of bad) {
      const before = await rowsAt(storagePath);
      expect(await upload({ storagePath }), storagePath).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(await rowsAt(storagePath)).toBe(before);
    }
  });

  it("R11: registering B's file and replacing it can't delete B's file", async () => {
    signInAs(A.subject);
    const victim = pathFor(B.subject!, ownedByB.id);
    await upload({ storagePath: victim, imageType: "cover" });
    await upload({ imageType: "cover" });
    expect(deletedFromStorage).not.toContain(victim);
  });

  it("R33: replacing the logo replaces the logo and keeps the cover", async () => {
    signInAs(A.subject);
    const result = await upload({ imageType: "logo" });
    expect(result.success).toBe(true);
    expect(await imageRow(image("cover").id)).toBeDefined();
    expect(await imageRow(image("logo").id)).toBeUndefined();
    expect(deletedFromStorage).toEqual(["fixtures/logo.png"]);
  });

  it("refuses types and sizes outside the limits", async () => {
    signInAs(A.subject);
    const bad: Record<string, unknown>[] = [
      { mimeType: "image/svg+xml" },
      { mimeType: "text/html" },
      { mimeType: undefined },
      { fileSize: 5 * 1024 * 1024 + 1 },
      { fileSize: 0 },
      { fileSize: undefined },
      { width: -1 },
      { height: 1.5 },
      { aspectRatio: "21:9" },
      { imageType: "banner" },
      { fileName: "x".repeat(256) },
      { altText: "x".repeat(1001) },
    ];
    for (const over of bad) {
      expect(await upload(over), JSON.stringify(over)).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    }
    expect(await rowsAt(pathFor(A.subject!, listed.id))).toBe(0);
  });

  it("signed out, another user, a deleted project or the Better Auth switch alone: no row", async () => {
    expect(await upload()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    signInAs(B.subject);
    expect(await upload({ storagePath: pathFor(B.subject!, listed.id) })).toMatchObject({ success: false, code: "FORBIDDEN" });
    signInAs(A.subject);
    expect(
      await upload({ projectId: deletedRecent.id, storagePath: pathFor(A.subject!, deletedRecent.id) }),
    ).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
    expect(await upload({ projectId: "not-a-uuid" })).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_AUTH_BACKEND", "better-auth");
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3390");
    vi.stubEnv("CODEDETAILS_CONVEX_SITE_URL", "http://127.0.0.1:3391");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
    expect(await upload()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(await rowsAt(pathFor(A.subject!, listed.id))).toBe(0);
  });

  it("R12: reorder moves the project's own images and never another project's", async () => {
    const bobImage = await insertImage(ownedByB.id, "bob-shot", 7);
    signInAs(A.subject);
    const result = await actions.reorderProjectImagesAction(listed.id, [
      { imageId: image("screenshot-1").id, order: 2 },
      { imageId: image("screenshot-2").id, order: 1 },
      { imageId: bobImage, order: 0 },
    ]);
    expect(result.success).toBe(true);
    expect((await imageRow(image("screenshot-1").id)).display_order).toBe(2);
    expect((await imageRow(image("screenshot-2").id)).display_order).toBe(1);
    expect((await imageRow(bobImage)).display_order).toBe(7);
  });

  it("R12: reorder refuses other people's projects and malformed orders", async () => {
    signInAs(B.subject);
    expect(
      await actions.reorderProjectImagesAction(listed.id, [{ imageId: image("screenshot-1").id, order: 9 }]),
    ).toMatchObject({ success: false, code: "FORBIDDEN" });
    signInAs(A.subject);
    for (const orders of [[{ imageId: "x", order: 1 }], [{ imageId: image("screenshot-1").id, order: 1.5 }], "nope"]) {
      expect(
        await actions.reorderProjectImagesAction(listed.id, orders as never),
      ).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    }
    expect((await imageRow(image("screenshot-1").id)).display_order).toBe(1);
  });

  it("the unvalidated update and the unused count read are no longer callable", () => {
    expect((actions as Record<string, unknown>).updateProjectImageAction).toBeUndefined();
    expect((actions as Record<string, unknown>).getImageCountAction).toBeUndefined();
  });

  it("a deleted project's images are hidden from everyone but the owner", async () => {
    const hidden = await insertImage(deletedRecent.id, "deleted-project-shot");
    await sql`update project_images set image_type = 'cover' where id = ${hidden}`;
    for (const who of [null, B.subject!]) {
      signInAs(who);
      expect(await actions.getProjectImagesAction(deletedRecent.id)).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
      expect(await actions.getProjectCoverImageAction(deletedRecent.id)).toEqual({ success: true, data: null });
    }
    signInAs(A.subject);
    const own = await actions.getProjectImagesAction(deletedRecent.id);
    expect(own.success && own.data.map((i) => i.id)).toEqual([hidden]);
  });

  it("a public project's images stay readable signed out, as before", async () => {
    const all = await actions.getProjectImagesAction(listed.id);
    expect(all.success && all.data.length).toBe(4);
    const cover = await actions.getProjectCoverImageAction(listed.id);
    expect(cover.success && cover.data?.id).toBe(image("cover").id);
    expect(await actions.getProjectImagesAction("not-a-uuid")).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
  });

  it("set-cover and deletes: owner only; a deleted image can't become the cover", async () => {
    signInAs(B.subject);
    expect(await actions.setProjectCoverImageAction(image("screenshot-1").id)).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await actions.deleteProjectImageAction(image("screenshot-1").id)).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await actions.permanentlyDeleteProjectImageAction(image("screenshot-1").id)).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(await imageRow(image("screenshot-1").id)).toMatchObject({ deleted_at: null, image_type: "screenshot" });

    signInAs(A.subject);
    expect(await actions.setProjectCoverImageAction(image("screenshot-deleted").id)).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
    expect(await actions.setProjectCoverImageAction("not-a-uuid")).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
    expect((await actions.setProjectCoverImageAction(image("screenshot-1").id)).success).toBe(true);
    expect((await imageRow(image("cover").id)).image_type).toBe("screenshot");
    expect((await imageRow(image("screenshot-1").id)).image_type).toBe("cover");
  });

  it("the owner can still delete images of their own deleted project", async () => {
    const shot = await insertImage(deletedRecent.id, "cleanup-shot");
    signInAs(A.subject);
    const result = await actions.permanentlyDeleteProjectImageAction(shot);
    expect(result).toEqual({ success: true, data: { storagePath: "fixtures/cleanup-shot.png" } });
    expect(await imageRow(shot)).toBeUndefined();
  });
});
