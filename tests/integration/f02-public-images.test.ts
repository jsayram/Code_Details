// F02 slice 1: what a signed-out caller gets from the image read, now that the
// project page asks for images without a session. The server is the gate, so
// these run against the real query as the anonymous client.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs } from "../fixtures/convex-auth";

type View = Record<string, unknown> & { kind: string; url: string | null };
const fn = {
  list: makeFunctionReference<"query", { projectId: string }, View[] | null>("projectImages:listForProject"),
  cover: makeFunctionReference<"query", { projectId: string }, View | null>("projectImages:coverForProject"),
  addImages: makeFunctionReference<"action", { projectId: string; count: number }, string[]>("fixtures:addProjectImages"),
};

const set = generateFixtures();
const { a: A, b: B } = set.personas;
const FIELDS = ["altText", "aspectRatio", "caption", "createdAt", "displayOrder", "fileName", "height", "id", "kind", "mimeType", "projectId", "size", "url", "width"];

describe.skipIf(!convexAvailable())("F02 images for signed-out viewers", () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("a listed project: active images only, with exactly the public fields", async () => {
    const stored = await adminClient().action(fn.addImages, { projectId: ids["fixture-listed"], count: 3 }); // the last is soft-deleted
    const images = await anonymousClient().query(fn.list, { projectId: ids["fixture-listed"] });
    expect(images?.map((i) => i.kind)).toEqual(["cover", "screenshot"]);
    for (const image of images!) {
      expect(Object.keys(image).sort()).toEqual(FIELDS);
      expect(image.url).toBeTruthy();
      const text = JSON.stringify(image);
      expect(text).not.toContain(A.subject!);
      for (const storageId of stored) expect(Object.values(image)).not.toContain(storageId);
    }
    expect((await anonymousClient().query(fn.cover, { projectId: ids["fixture-listed"] }))?.kind).toBe("cover");
  });

  it("a private project's images: its owner only, however they got there", async () => {
    const projectId = ids["fixture-private"];
    await adminClient().action(fn.addImages, { projectId, count: 1 });
    expect(await anonymousClient().query(fn.list, { projectId })).toBeNull();
    expect(await anonymousClient().query(fn.cover, { projectId })).toBeNull();
    expect(await clientAs(B.subject!).query(fn.list, { projectId })).toBeNull();
    expect((await clientAs(A.subject!).query(fn.list, { projectId }))?.length).toBe(1);
  });

  it("a deleted project's images: its owner only", async () => {
    const projectId = ids["fixture-deleted-recent"];
    await adminClient().action(fn.addImages, { projectId, count: 1 });
    expect(await anonymousClient().query(fn.list, { projectId })).toBeNull();
    expect(await anonymousClient().query(fn.cover, { projectId })).toBeNull();
    expect(await clientAs(B.subject!).query(fn.list, { projectId })).toBeNull();
    expect((await clientAs(A.subject!).query(fn.list, { projectId }))?.length).toBe(1);
  });
});
