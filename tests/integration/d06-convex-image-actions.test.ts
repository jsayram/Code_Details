// D06-b: the image server actions under the Convex read switch alone (Clerk
// login): reads go anonymously to the local backend and come back in the row
// shape the components read, with no storage path or uploader; writes stay on
// the Supabase path, which refuses a Convex ID, so nothing reaches Convex
// without the Better Auth switch too.
import { makeFunctionReference } from "convex/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, clearConvexFixtures, convexAvailable, CONVEX_URL, loadConvexFixtures } from "../fixtures/convex";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const addImages = makeFunctionReference<"action", { projectId: string; count: number }, string[]>("fixtures:addProjectImages");
const imageState = makeFunctionReference<"query", { projectId: string }, { id: string; status: string }[]>("fixtures:imageState");

const set = generateFixtures();
const { a: A } = set.personas;

describe.skipIf(!convexAvailable())("D06-b image actions, Convex read switch", () => {
  let ids: Record<string, string>;
  let actions: typeof import("../../src/app/actions/project-images.js");

  beforeAll(async () => {
    actions = await import("../../src/app/actions/project-images.js");
  });
  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "convex");
    vi.stubEnv("CODEDETAILS_CONVEX_URL", CONVEX_URL);
    signInAs(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("a listed project's images, anonymously, in the components' row shape", async () => {
    await adminClient().action(addImages, { projectId: ids["fixture-listed"], count: 3 }); // cover, screenshot, deleted screenshot
    const result = await actions.getProjectImagesAction(ids["fixture-listed"]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((r) => r.image_type)).toEqual(["cover", "screenshot"]);
    for (const row of result.data) {
      expect(row).toMatchObject({ project_id: ids["fixture-listed"], storage_path: "", uploaded_by: "", deleted_at: null, mime_type: "image/png" });
      expect(row.storage_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/storage\//);
    }
    const cover = await actions.getProjectCoverImageAction(ids["fixture-listed"]);
    expect(cover.success && cover.data?.image_type).toBe("cover");
  });

  it("a deleted project's images stay hidden from an anonymous read", async () => {
    await adminClient().action(addImages, { projectId: ids["fixture-deleted-recent"], count: 1 });
    expect(await actions.getProjectImagesAction(ids["fixture-deleted-recent"])).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
    expect(await actions.getProjectCoverImageAction(ids["fixture-deleted-recent"])).toEqual({ success: true, data: null });
  });

  it("without the Better Auth switch, writes never reach Convex", async () => {
    await adminClient().action(addImages, { projectId: ids["fixture-listed"], count: 1 });
    const [row] = await adminClient().query(imageState, { projectId: ids["fixture-listed"] });
    signInAs(A.subject);
    // D08g4f2: no Supabase upload either; it refuses.
    expect(await actions.beginProjectImageUploadAction(ids["fixture-listed"], "cover")).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect((await actions.permanentlyDeleteProjectImageAction(row.id)).success).toBe(false);
    expect((await actions.deleteProjectImageAction(row.id)).success).toBe(false);
    expect(await adminClient().query(imageState, { projectId: ids["fixture-listed"] })).toEqual([row]);
  });
});
