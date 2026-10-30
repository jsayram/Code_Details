// D06-b: project images on Convex _storage (P07 §3.10, §5.11; P08 R10–R13, R33).
// Upload, attach, reorder, set-cover, soft delete and purge are separate
// operations. Every one takes the caller from getViewer only; no function
// takes a path, a URL or a user.
//
// - Upload: generateUploadUrl checks the caller owns the active, public
//   project and the per-kind limit, then hands out a one-time upload URL. The
//   browser posts the bytes there and gets a storage ID back.
// - Attach: reads the file's type and size from _storage system metadata (not
//   the client's claim), refuses anything outside the allowlist or over 5 MB
//   (and deletes that file), and refuses a storage ID that is already some
//   image's. Cover and logo replace the active image of the same kind (R33).
// - Private projects get no images: getUrl URLs are bearer links, so until an
//   access-checked route exists (D06x) a private project can't hold any.
// - Reorder moves only the authorized project's images (R12).
// - Soft delete keeps the file; purge deletes the row and schedules the file's
//   deletion on the server (R13: the browser never deletes files).
// - Reads compute URLs on the fly; nothing stores a URL. A listed project's
//   images are public; anything else only its owner (or an admin) sees.
// Refusals that would reveal a hidden project answer not_found.
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewer, type Viewer } from "./viewer";

export const IMAGE_KINDS = ["cover", "screenshot", "diagram", "logo"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];
/** Same per-kind limits as the Supabase action (src/app/actions/project-images.ts). */
export const IMAGE_LIMITS: Record<ImageKind, number> = { cover: 1, screenshot: 20, diagram: 10, logo: 1 };
/** PROJECT_IMAGE_LIMITS / ALLOWED_IMAGE_TYPES in src/constants/project-limits.ts. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const ASPECT_RATIOS = ["auto", "16:9", "4:3", "1:1"];
const MAX_FILE_NAME = 255;
const MAX_TEXT = 1000;
const MAX_DIMENSION = 20000;
const MAX_ORDER = 1000;

const kindValidator = v.union(v.literal("cover"), v.literal("screenshot"), v.literal("diagram"), v.literal("logo"));

export interface ImageView {
  id: string;
  projectId: string;
  kind: ImageKind;
  url: string | null;
  displayOrder: number;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  altText: string | null;
  caption: string | null;
  createdAt: number;
}

export type ImageFailure = { ok: false; code: "not_found" | "private_project" | "limit" | "invalid"; message?: string };

async function toView(ctx: QueryCtx, image: Doc<"projectImages">): Promise<ImageView> {
  return {
    id: image._id,
    projectId: image.projectId,
    kind: image.kind,
    url: await ctx.storage.getUrl(image.storageId),
    displayOrder: image.displayOrder,
    fileName: image.fileName,
    mimeType: image.mimeType,
    size: image.size,
    width: image.width ?? null,
    height: image.height ?? null,
    aspectRatio: image.aspectRatio ?? null,
    altText: image.altText ?? null,
    caption: image.caption ?? null,
    createdAt: image.createdAt,
  };
}

async function loadProject(ctx: QueryCtx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  return id ? await ctx.db.get(id) : null;
}

/** The project when the caller owns it, else null. `active` also requires it not to be deleted. */
async function ownedProject(ctx: QueryCtx, viewer: Viewer | null, projectId: string, { active }: { active: boolean }) {
  const project = await loadProject(ctx, projectId);
  if (!viewer || !project || project.ownerId !== viewer.userId) return null;
  if (active && project.status !== "active") return null;
  return project;
}

/** The image and its project when the caller owns the project, else null. */
async function ownedImage(ctx: QueryCtx, viewer: Viewer | null, imageId: string) {
  const id = ctx.db.normalizeId("projectImages", imageId);
  const image = id ? await ctx.db.get(id) : null;
  if (!viewer || !image) return null;
  const project = await ctx.db.get(image.projectId);
  if (!project || project.ownerId !== viewer.userId) return null;
  return { image, project };
}

/** Whoever may see the project's images: anyone for a listed project, else its owner or an admin. */
function canSee(project: Doc<"projects">, viewer: Viewer | null): boolean {
  if (project.listed) return true;
  return !!viewer && (project.ownerId === viewer.userId || viewer.role === "admin");
}

function activeOfKind(ctx: QueryCtx, projectId: Id<"projects">, kind: ImageKind) {
  return ctx.db
    .query("projectImages")
    .withIndex("by_project_kind_status", (q) => q.eq("projectId", projectId).eq("kind", kind).eq("status", "active"))
    .collect();
}

/** Removes the row now and the file through the retrying deleter (projectLifecycle.deleteStoredFile). */
async function purgeImage(ctx: MutationCtx, image: Doc<"projectImages">) {
  await ctx.db.delete(image._id);
  await ctx.scheduler.runAfter(0, internal.projectLifecycle.deleteStoredFile, { storageId: image.storageId, attempt: 1 });
}

function badText(value: string | undefined, max: number) {
  return value !== undefined && value.length > max;
}
function badInt(value: number | undefined, max: number) {
  return value !== undefined && (!Number.isInteger(value) || value <= 0 || value > max);
}

/** Display name only: no path separators or control characters. */
function cleanFileName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
}

export const generateUploadUrl = mutation({
  args: { projectId: v.string(), kind: kindValidator },
  handler: async (ctx, { projectId, kind }): Promise<{ ok: true; uploadUrl: string } | ImageFailure> => {
    const project = await ownedProject(ctx, await getViewer(ctx), projectId, { active: true });
    if (!project) return { ok: false, code: "not_found" };
    if (project.visibility !== "public") return { ok: false, code: "private_project" };
    // Cover and logo replace the current one on attach, so only the others can be full.
    if (kind !== "cover" && kind !== "logo" && (await activeOfKind(ctx, project._id, kind)).length >= IMAGE_LIMITS[kind]) {
      return { ok: false, code: "limit" };
    }
    return { ok: true, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const attach = mutation({
  args: {
    projectId: v.string(),
    storageId: v.string(),
    kind: kindValidator,
    fileName: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    aspectRatio: v.optional(v.string()),
    altText: v.optional(v.string()),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; image: ImageView } | ImageFailure> => {
    const viewer = await getViewer(ctx);
    const project = await ownedProject(ctx, viewer, args.projectId, { active: true });
    const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
    const file = storageId ? await ctx.db.system.get(storageId) : null;
    if (!viewer || !project || !storageId || !file) return { ok: false, code: "not_found" };
    // A file that is already an image (anyone's) can't be attached again, so
    // nobody can take over, and later delete, someone else's file.
    const taken = await ctx.db.query("projectImages").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first();
    if (taken) return { ok: false, code: "not_found" };
    if (project.visibility !== "public") return { ok: false, code: "private_project" };

    // Type and size from the stored file, never from the client.
    const contentType = file.contentType ?? "";
    if (!ALLOWED_IMAGE_TYPES.includes(contentType) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "invalid", message: `Images must be ${ALLOWED_IMAGE_TYPES.join(", ")} and at most 5MB` };
    }
    const fileName = cleanFileName(args.fileName);
    if (
      !fileName ||
      fileName.length > MAX_FILE_NAME ||
      badInt(args.width, MAX_DIMENSION) ||
      badInt(args.height, MAX_DIMENSION) ||
      (args.aspectRatio !== undefined && !ASPECT_RATIOS.includes(args.aspectRatio)) ||
      badText(args.altText, MAX_TEXT) ||
      badText(args.caption, MAX_TEXT)
    ) {
      return { ok: false, code: "invalid", message: "Invalid image details" };
    }

    const current = await activeOfKind(ctx, project._id, args.kind);
    if (args.kind === "cover" || args.kind === "logo") {
      for (const old of current) await purgeImage(ctx, old);
    } else if (current.length >= IMAGE_LIMITS[args.kind]) {
      return { ok: false, code: "limit" };
    }

    const id = await ctx.db.insert("projectImages", {
      projectId: project._id,
      storageId,
      kind: args.kind,
      displayOrder: args.kind === "cover" || args.kind === "logo" ? 0 : current.length,
      fileName,
      mimeType: contentType,
      size: file.size,
      uploadedBy: viewer.userId,
      status: "active",
      createdAt: Date.now(),
      ...(args.width !== undefined && { width: args.width }),
      ...(args.height !== undefined && { height: args.height }),
      aspectRatio: args.aspectRatio ?? "auto",
      ...(args.altText !== undefined && { altText: args.altText }),
      ...(args.caption !== undefined && { caption: args.caption }),
    });
    return { ok: true, image: await toView(ctx, (await ctx.db.get(id))!) };
  },
});

export const reorder = mutation({
  args: { projectId: v.string(), order: v.array(v.object({ imageId: v.string(), displayOrder: v.number() })) },
  handler: async (ctx, { projectId, order }): Promise<{ ok: true } | ImageFailure> => {
    const project = await ownedProject(ctx, await getViewer(ctx), projectId, { active: true });
    if (!project) return { ok: false, code: "not_found" };
    if (order.length > 100 || order.some((o) => !Number.isInteger(o.displayOrder) || o.displayOrder < 0 || o.displayOrder > MAX_ORDER)) {
      return { ok: false, code: "invalid", message: "Invalid image order" };
    }
    for (const { imageId, displayOrder } of order) {
      const id = ctx.db.normalizeId("projectImages", imageId);
      const image = id ? await ctx.db.get(id) : null;
      // Another project's image matches nothing, as on the Supabase path.
      if (image && image.projectId === project._id) await ctx.db.patch(image._id, { displayOrder });
    }
    return { ok: true };
  },
});

export const setCover = mutation({
  args: { imageId: v.string() },
  handler: async (ctx, { imageId }): Promise<{ ok: true; image: ImageView } | ImageFailure> => {
    const owned = await ownedImage(ctx, await getViewer(ctx), imageId);
    if (!owned || owned.image.status !== "active" || owned.project.status !== "active") return { ok: false, code: "not_found" };
    const { image, project } = owned;
    for (const cover of await activeOfKind(ctx, project._id, "cover")) {
      if (cover._id !== image._id) await ctx.db.patch(cover._id, { kind: "screenshot" });
    }
    await ctx.db.patch(image._id, { kind: "cover" });
    return { ok: true, image: await toView(ctx, (await ctx.db.get(image._id))!) };
  },
});

/** Soft delete: the row goes to deleted and the file stays (P07 §5.11). Allowed on the owner's deleted project. */
export const softDelete = mutation({
  args: { imageId: v.string() },
  handler: async (ctx, { imageId }): Promise<{ ok: true } | ImageFailure> => {
    const owned = await ownedImage(ctx, await getViewer(ctx), imageId);
    if (!owned) return { ok: false, code: "not_found" };
    if (owned.image.status === "active") await ctx.db.patch(owned.image._id, { status: "deleted", deletedAt: Date.now() });
    return { ok: true };
  },
});

/** Purge: the row now, the file on the server right after. Allowed on the owner's deleted project. */
export const purge = mutation({
  args: { imageId: v.string() },
  handler: async (ctx, { imageId }): Promise<{ ok: true } | ImageFailure> => {
    const owned = await ownedImage(ctx, await getViewer(ctx), imageId);
    if (!owned) return { ok: false, code: "not_found" };
    await purgeImage(ctx, owned.image);
    return { ok: true };
  },
});

/** Active images in display order, or null when the caller may not see the project. */
export const listForProject = query({
  args: { projectId: v.string(), kind: v.optional(kindValidator) },
  handler: async (ctx, { projectId, kind }): Promise<ImageView[] | null> => {
    const project = await loadProject(ctx, projectId);
    if (!project || !canSee(project, await getViewer(ctx))) return null;
    const images = await ctx.db
      .query("projectImages")
      .withIndex("by_project_status_order", (q) => q.eq("projectId", project._id).eq("status", "active"))
      .take(100);
    return Promise.all(images.filter((i) => !kind || i.kind === kind).map((i) => toView(ctx, i)));
  },
});

/** The active cover, looked up by kind; null when there is none or the caller may not see the project. */
export const coverForProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }): Promise<ImageView | null> => {
    const project = await loadProject(ctx, projectId);
    if (!project || !canSee(project, await getViewer(ctx))) return null;
    const [cover] = await activeOfKind(ctx, project._id, "cover");
    return cover ? toView(ctx, cover) : null;
  },
});
