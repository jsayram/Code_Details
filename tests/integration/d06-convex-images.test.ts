// D06-b: project images on the task-owned test backend (P07 §3.10, §5.11; P08
// R10–R13, R33). The caller comes only from getViewer (the D01 synthetic
// issuer for the fixture personas). Uploads go through the real one-time
// upload URL over HTTP, so the stored type and size are whatever the backend
// recorded, never a claim in the mutation's arguments.
import { makeFunctionReference } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";

type Kind = "cover" | "screenshot" | "diagram" | "logo";
type Failure = { ok: false; code: string; message?: string };
type ImageView = { id: string; projectId: string; kind: Kind; url: string | null; displayOrder: number; mimeType: string; size: number; fileName: string };
type Row = { id: string; storageId: string; kind: Kind; status: string; displayOrder: number; mimeType: string; size: number; fileExists: boolean };

const fn = {
  uploadUrl: makeFunctionReference<"mutation", { projectId: string; kind: Kind }, { ok: true; uploadUrl: string } | Failure>("projectImages:generateUploadUrl"),
  attach: makeFunctionReference<"mutation", Record<string, unknown>, { ok: true; image: ImageView } | Failure>("projectImages:attach"),
  reorder: makeFunctionReference<"mutation", { projectId: string; order: { imageId: string; displayOrder: number }[] }, { ok: true } | Failure>("projectImages:reorder"),
  setCover: makeFunctionReference<"mutation", { imageId: string }, { ok: true; image: ImageView } | Failure>("projectImages:setCover"),
  softDelete: makeFunctionReference<"mutation", { imageId: string }, { ok: true } | Failure>("projectImages:softDelete"),
  purge: makeFunctionReference<"mutation", { imageId: string }, { ok: true } | Failure>("projectImages:purge"),
  list: makeFunctionReference<"query", { projectId: string; kind?: Kind }, ImageView[] | null>("projectImages:listForProject"),
  cover: makeFunctionReference<"query", { projectId: string }, ImageView | null>("projectImages:coverForProject"),
  state: makeFunctionReference<"query", { projectId: string }, Row[]>("fixtures:imageState"),
  fileExists: makeFunctionReference<"query", { storageId: string }, boolean>("fixtures:fileExists"),
  store: makeFunctionReference<"action", { contentType: string; bytes: number }, string>("fixtures:storeUnattachedFile"),
  addImages: makeFunctionReference<"action", { projectId: string; count: number }, string[]>("fixtures:addProjectImages"),
};

const set = generateFixtures();
const { a: A, b: B } = set.personas;
const asA = () => clientAs(A.subject!);
const asB = () => clientAs(B.subject!);
const state = (projectId: string) => adminClient().query(fn.state, { projectId });
const MB5 = 5 * 1024 * 1024;

/** Uploads bytes through a real upload URL issued to `client`; returns the storage ID. */
async function upload(client: ConvexHttpClient, projectId: string, kind: Kind, contentType = "image/png", bytes = 64): Promise<string> {
  const issued = await client.mutation(fn.uploadUrl, { projectId, kind });
  if (!issued.ok) throw new Error(`no upload URL: ${issued.code}`);
  const res = await fetch(issued.uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: new Uint8Array(bytes) });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { storageId: string }).storageId;
}

const attach = (client: ConvexHttpClient, projectId: string, storageId: string, kind: Kind, extra: Record<string, unknown> = {}) =>
  client.mutation(fn.attach, { projectId, storageId, kind, fileName: `${kind}.png`, ...extra });

async function fileGone(storageId: string) {
  await expect.poll(() => adminClient().query(fn.fileExists, { storageId }), { timeout: 10_000 }).toBe(false);
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D06-b Convex images", () => {
  let ids: Record<string, string>;
  const listed = () => ids["fixture-listed"]; // A's
  const bobs = () => ids["fixture-bob-project"]; // B's

  beforeEach(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("the owner uploads and attaches; type and size come from the stored file", async () => {
    const storageId = await upload(asA(), listed(), "screenshot", "image/webp", 1234);
    // A type or size claim isn't even accepted as an argument.
    await expect(attach(asA(), listed(), storageId, "screenshot", { mimeType: "image/png" })).rejects.toThrow(/extra field `mimeType`/);
    await expect(attach(asA(), listed(), storageId, "screenshot", { size: 1 })).rejects.toThrow(/extra field `size`/);
    const r = await attach(asA(), listed(), storageId, "screenshot", { width: 800, height: 600, aspectRatio: "16:9" });
    expect(r).toMatchObject({ ok: true, image: { kind: "screenshot", mimeType: "image/webp", size: 1234, displayOrder: 0 } });
    if (!r.ok) return;
    expect(r.image.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/storage\//);
    expect(await state(listed())).toEqual([expect.objectContaining({ storageId, status: "active", mimeType: "image/webp", size: 1234, fileExists: true })]);
  });

  it("a stored file of the wrong type or over 5 MB is refused and deleted", async () => {
    for (const [type, bytes] of [["text/html", 64], ["image/svg+xml", 64], ["image/png", MB5 + 1], ["image/png", 0]] as const) {
      const storageId = await upload(asA(), listed(), "screenshot", type, bytes);
      expect(await attach(asA(), listed(), storageId, "screenshot"), `${type} ${bytes}`).toMatchObject({ ok: false, code: "invalid" });
      expect(await adminClient().query(fn.fileExists, { storageId })).toBe(false);
    }
    expect(await state(listed())).toEqual([]);
  });

  it("bad details are refused and the file is kept for a corrected attach", async () => {
    const storageId = await upload(asA(), listed(), "screenshot");
    for (const extra of [{ width: -1 }, { height: 1.5 }, { aspectRatio: "21:9" }, { altText: "x".repeat(1001) }, { fileName: "" }, { fileName: "x".repeat(256) }]) {
      expect(await attach(asA(), listed(), storageId, "screenshot", extra), JSON.stringify(extra).slice(0, 40)).toMatchObject({ ok: false, code: "invalid" });
    }
    expect((await attach(asA(), listed(), storageId, "screenshot", { fileName: "../../etc/passwd" })).ok).toBe(true);
    expect((await asA().query(fn.list, { projectId: listed() }))![0].fileName).toBe(".._.._etc_passwd");
  });

  it("no images on a private project", async () => {
    const priv = ids["fixture-private"];
    expect(await asA().mutation(fn.uploadUrl, { projectId: priv, kind: "cover" })).toEqual({ ok: false, code: "private_project" });
    const storageId = await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 });
    expect(await attach(asA(), priv, storageId, "cover")).toEqual({ ok: false, code: "private_project" });
    expect(await state(priv)).toEqual([]);
  });

  it("another user, a signed-out caller, a deleted project or a bad ID: not_found and nothing changes", async () => {
    const storageId = await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 });
    for (const client of [asB(), anonymousClient()]) {
      expect(await client.mutation(fn.uploadUrl, { projectId: listed(), kind: "screenshot" })).toEqual({ ok: false, code: "not_found" });
      expect(await attach(client, listed(), storageId, "screenshot")).toEqual({ ok: false, code: "not_found" });
    }
    expect(await asA().mutation(fn.uploadUrl, { projectId: ids["fixture-deleted-recent"], kind: "screenshot" })).toEqual({ ok: false, code: "not_found" });
    expect(await attach(asA(), ids["fixture-deleted-recent"], storageId, "screenshot")).toEqual({ ok: false, code: "not_found" });
    expect(await attach(asA(), "not-an-id", storageId, "screenshot")).toEqual({ ok: false, code: "not_found" });
    expect(await attach(asA(), listed(), "not-a-storage-id", "screenshot")).toEqual({ ok: false, code: "not_found" });
    expect(await state(listed())).toEqual([]);
  });

  it("a file that is already an image can't be attached again, so nobody can take it over and delete it", async () => {
    const storageId = await upload(asA(), listed(), "cover");
    expect((await attach(asA(), listed(), storageId, "cover")).ok).toBe(true);
    expect(await attach(asB(), bobs(), storageId, "cover")).toEqual({ ok: false, code: "not_found" });
    expect(await attach(asA(), listed(), storageId, "screenshot")).toEqual({ ok: false, code: "not_found" });
    expect(await state(bobs())).toEqual([]);
    expect(await adminClient().query(fn.fileExists, { storageId })).toBe(true);
  });

  it("R33: a new logo replaces the logo, keeps the cover, and the old logo's file is deleted", async () => {
    const cover = await upload(asA(), listed(), "cover");
    const logo1 = await upload(asA(), listed(), "logo");
    const logo2 = await upload(asA(), listed(), "logo");
    expect((await attach(asA(), listed(), cover, "cover")).ok).toBe(true);
    expect((await attach(asA(), listed(), logo1, "logo")).ok).toBe(true);
    expect((await attach(asA(), listed(), logo2, "logo")).ok).toBe(true);
    const rows = await state(listed());
    expect(rows.map((r) => [r.kind, r.storageId])).toEqual([["cover", cover], ["logo", logo2]]);
    await fileGone(logo1);
    expect(await adminClient().query(fn.fileExists, { storageId: cover })).toBe(true);
  });

  it("per-kind limits count active images only", async () => {
    for (let i = 0; i < 10; i++) {
      const storageId = await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 });
      expect((await attach(asA(), listed(), storageId, "diagram")).ok).toBe(true);
    }
    expect(await asA().mutation(fn.uploadUrl, { projectId: listed(), kind: "diagram" })).toEqual({ ok: false, code: "limit" });
    const extra = await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 });
    expect(await attach(asA(), listed(), extra, "diagram")).toEqual({ ok: false, code: "limit" });
    const first = (await state(listed()))[0];
    expect(await asA().mutation(fn.softDelete, { imageId: first.id })).toEqual({ ok: true });
    expect((await attach(asA(), listed(), extra, "diagram")).ok).toBe(true);
  });

  it("R12: reorder moves only the authorized project's images", async () => {
    const mine = [];
    for (let i = 0; i < 2; i++) {
      const r = await attach(asA(), listed(), await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 }), "screenshot");
      if (r.ok) mine.push(r.image.id);
    }
    const r = await attach(asB(), bobs(), await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 }), "screenshot");
    const bobsImage = r.ok ? r.image.id : "";
    const order = [{ imageId: mine[0], displayOrder: 5 }, { imageId: mine[1], displayOrder: 4 }, { imageId: bobsImage, displayOrder: 9 }];
    expect(await asA().mutation(fn.reorder, { projectId: listed(), order })).toEqual({ ok: true });
    expect((await state(listed())).map((x) => [x.id, x.displayOrder])).toEqual([[mine[1], 4], [mine[0], 5]]);
    expect((await state(bobs()))[0].displayOrder).toBe(0);
    expect(await asB().mutation(fn.reorder, { projectId: listed(), order })).toEqual({ ok: false, code: "not_found" });
    expect(await asA().mutation(fn.reorder, { projectId: listed(), order: [{ imageId: mine[0], displayOrder: 1.5 }] })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("set-cover promotes one image and demotes the old cover; owner only; not a deleted image", async () => {
    const cover = await attach(asA(), listed(), await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 }), "cover");
    const shot = await attach(asA(), listed(), await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 }), "screenshot");
    if (!cover.ok || !shot.ok) throw new Error("setup");
    expect(await asB().mutation(fn.setCover, { imageId: shot.image.id })).toEqual({ ok: false, code: "not_found" });
    expect(await asA().mutation(fn.setCover, { imageId: shot.image.id })).toMatchObject({ ok: true, image: { kind: "cover" } });
    expect((await asA().query(fn.cover, { projectId: listed() }))?.id).toBe(shot.image.id);
    expect((await state(listed())).find((x) => x.id === cover.image.id)?.kind).toBe("screenshot");
    await asA().mutation(fn.softDelete, { imageId: cover.image.id });
    expect(await asA().mutation(fn.setCover, { imageId: cover.image.id })).toEqual({ ok: false, code: "not_found" });
  });

  it("soft delete keeps the file; purge removes the row and then the file; owner only", async () => {
    const r = await attach(asA(), listed(), await upload(asA(), listed(), "screenshot"), "screenshot");
    if (!r.ok) throw new Error("setup");
    const [{ storageId }] = await state(listed());
    for (const op of [fn.softDelete, fn.purge]) {
      expect(await asB().mutation(op, { imageId: r.image.id })).toEqual({ ok: false, code: "not_found" });
      expect(await anonymousClient().mutation(op, { imageId: r.image.id })).toEqual({ ok: false, code: "not_found" });
    }
    expect(await asA().mutation(fn.softDelete, { imageId: r.image.id })).toEqual({ ok: true });
    expect(await state(listed())).toEqual([expect.objectContaining({ status: "deleted", fileExists: true })]);
    expect(await asA().query(fn.list, { projectId: listed() })).toEqual([]);
    expect(await asA().mutation(fn.purge, { imageId: r.image.id })).toEqual({ ok: true });
    expect(await state(listed())).toEqual([]);
    await fileGone(storageId);
  });

  it("reads: a listed project's active images for anyone, a deleted project's only for its owner", async () => {
    await attach(asA(), listed(), await adminClient().action(fn.store, { contentType: "image/png", bytes: 64 }), "cover");
    const anon = await anonymousClient().query(fn.list, { projectId: listed() });
    expect(anon?.map((i) => i.kind)).toEqual(["cover"]);
    expect(anon?.[0].url).toBeTruthy();
    expect(Object.keys(anon![0])).not.toContain("uploadedBy");
    expect((await anonymousClient().query(fn.list, { projectId: listed(), kind: "logo" }))).toEqual([]);

    const deleted = ids["fixture-deleted-recent"];
    await adminClient().action(fn.addImages, { projectId: deleted, count: 2 }); // cover active, second soft-deleted
    expect(await anonymousClient().query(fn.list, { projectId: deleted })).toBeNull();
    expect(await asB().query(fn.list, { projectId: deleted })).toBeNull();
    expect(await asB().query(fn.cover, { projectId: deleted })).toBeNull();
    expect((await asA().query(fn.list, { projectId: deleted }))?.map((i) => i.kind)).toEqual(["cover"]);
    expect(await anonymousClient().query(fn.list, { projectId: "not-an-id" })).toBeNull();
  });

  it("the owner can still clean up images of their deleted project", async () => {
    const deleted = ids["fixture-deleted-recent"];
    const [storageId] = await adminClient().action(fn.addImages, { projectId: deleted, count: 1 });
    const [row] = await state(deleted);
    expect(await asB().mutation(fn.purge, { imageId: row.id })).toEqual({ ok: false, code: "not_found" });
    expect(await asA().mutation(fn.purge, { imageId: row.id })).toEqual({ ok: true });
    await fileGone(storageId);
  });
});
