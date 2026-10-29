// D03: project create, soft delete, restore and purge (P07 §5.11, P08 R02/R03,
// R09, R13). Four separate operations; each takes the caller from getViewer
// only, never from an argument. A caller who may not act on a project gets
// not_found, the same answer as for a missing or malformed ID.
//
// - create: one transaction for the project, its tags, its slug, the tag
//   counters and the search outbox.
// - softDelete: active -> deleted. The project and its listed copies
//   (projectTags, favorites) leave every public list; nothing is removed, the
//   slug stays reserved.
// - restore: deleted -> active, and only from deleted.
// - purge: only from deleted, by the owner or an admin, and only when asked:
//   there is no automatic purge anywhere. The project row goes first, so a
//   purge can't be undone halfway or restored; its related rows go in the same
//   transaction up to a batch bound and the rest in scheduled batches. Image
//   files are deleted by a scheduled action that retries. The browser never
//   deletes files.
//
// Every scheduled step reads what is left by index, so running it twice, or
// late, does no harm.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { getViewer, type Viewer } from "./viewer";
import {
  type EditableProject,
  bumpListedCount,
  categoryValue,
  createMissingTags,
  resolveTags,
  slugTaken,
  toEditable,
} from "./projects";
import { CATEGORY_FIELDS_VERSION, type Issue, normalizeProjectPatch, titleSortKey } from "../src/backend/projects/project-update-rules";
import { PUBLIC_PROJECT_VERSION } from "../src/backend/projects/public-project";
import { FILE_DELETE_MAX_ATTEMPTS, LIFECYCLE_BATCH, fileDeleteRetryDelayMs } from "../src/backend/projects/lifecycle-rules";


export type CreateResult =
  | { ok: true; project: EditableProject }
  | { ok: false; code: "unauthorized" }
  | { ok: false; code: "invalid"; issues: Issue[] };

export type LifecycleResult = { ok: true; slug: string } | { ok: false; code: "not_found" };

const linkValue = v.object({ url: v.string(), label: v.optional(v.string()), type: v.optional(v.string()) });

export async function outbox(ctx: MutationCtx, projectId: Id<"projects">, change: "upsert" | "remove", sourceVersion: number, now: number) {
  await ctx.db.insert("contentChanges", {
    entityType: "project",
    entityId: projectId,
    change,
    sourceVersion,
    projectionVersion: PUBLIC_PROJECT_VERSION,
    createdAt: now,
    attempts: 0,
  });
}

/** `actor` null: the account-deletion purge (D04d), a system action with no person behind it. */
async function audit(ctx: MutationCtx, kind: "project.deleted" | "project.restored" | "project.purged", actor: Viewer | null, project: Doc<"projects">, now: number) {
  await ctx.db.insert("auditEvents", {
    kind,
    ...(actor ? { actorId: actor.userId } : {}),
    subjectTable: "projects",
    subjectId: project._id,
    at: now,
    details: actor ? { slug: project.slug, byOwner: project.ownerId === actor.userId } : { slug: project.slug, byOwner: false, accountDeletion: true },
  });
}

async function loadProject(ctx: MutationCtx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  return id ? await ctx.db.get(id) : null;
}

export const create = mutation({
  args: {
    // Closed: no owner, status, visibility, counters, versions or timestamps.
    project: v.object({
      title: v.string(),
      slug: v.string(),
      description: v.optional(v.union(v.string(), v.null())),
      category: v.string(),
      links: v.optional(v.array(linkValue)),
      tags: v.optional(v.array(v.string())),
      categoryData: v.optional(v.union(v.record(v.string(), categoryValue), v.null())),
      fieldOrder: v.optional(v.union(v.array(v.string()), v.null())),
    }),
  },
  handler: async (ctx, { project: input }): Promise<CreateResult> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return { ok: false, code: "unauthorized" };

    // ---- Checks (no writes) ----
    const { value, issues } = normalizeProjectPatch(input, input.category);
    if (value.slug !== undefined && !issues.some((i) => i.field === "slug") && (await slugTaken(ctx, value.slug, null))) {
      issues.push({ field: "slug", message: "This slug is already taken" });
    }
    const resolved = await resolveTags(ctx, value.tags ?? [], issues);
    if (issues.length) return { ok: false, code: "invalid", issues };

    // ---- Writes ----
    const now = Date.now();
    const tagIds = await createMissingTags(ctx, resolved, now);
    const listed = true; // new projects are public (P07 §5.9)
    const projectId = await ctx.db.insert("projects", {
      ownerId: viewer.userId,
      title: value.title!,
      titleSortKey: titleSortKey(value.title!),
      slug: value.slug!,
      description: value.description ?? undefined,
      category: value.category!,
      categoryData: value.categoryData ?? undefined,
      categoryDataVersion: value.categoryData ? CATEGORY_FIELDS_VERSION : undefined,
      fieldOrder: value.fieldOrder ?? undefined,
      links: value.links ?? [],
      visibility: "public",
      status: "active",
      listed,
      tagIds,
      tagCount: tagIds.length,
      favoriteCount: 0,
      rankingFavoriteCount: 0,
      contentVersion: 1,
      shuffleKey: Math.random(),
      createdAt: now,
      updatedAt: now,
    });
    for (const [position, tagId] of tagIds.entries()) {
      await ctx.db.insert("projectTags", { projectId, tagId, position, listed });
      await bumpListedCount(ctx, tagId, 1);
    }
    await ctx.db.insert("projectSlugs", { slug: value.slug!, projectId, state: "current", createdAt: now });
    await outbox(ctx, projectId, "upsert", 1, now);
    return { ok: true, project: await toEditable(ctx, (await ctx.db.get(projectId))!) };
  },
});

export const softDelete = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }): Promise<LifecycleResult> => {
    const viewer = await getViewer(ctx);
    const project = await loadProject(ctx, projectId);
    if (!viewer || !project || project.ownerId !== viewer.userId || project.status !== "active") {
      return { ok: false, code: "not_found" };
    }
    const now = Date.now();
    const contentVersion = project.contentVersion + 1;
    await ctx.db.patch(project._id, { status: "deleted", deletedAt: now, listed: false, contentVersion });
    if (project.listed) for (const tagId of project.tagIds) await bumpListedCount(ctx, tagId, -1);
    await syncListedCopies(ctx, project._id, "projectTags", null);
    await syncListedCopies(ctx, project._id, "favorites", null);
    await audit(ctx, "project.deleted", viewer, project, now);
    await outbox(ctx, project._id, "remove", contentVersion, now);
    return { ok: true, slug: project.slug };
  },
});

export const restore = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }): Promise<LifecycleResult> => {
    const viewer = await getViewer(ctx);
    const project = await loadProject(ctx, projectId);
    // Only from deleted (P07 §5.11).
    if (!viewer || !project || project.ownerId !== viewer.userId || project.status !== "deleted") {
      return { ok: false, code: "not_found" };
    }
    const now = Date.now();
    const contentVersion = project.contentVersion + 1;
    const listed = project.visibility === "public";
    await ctx.db.patch(project._id, { status: "active", deletedAt: undefined, listed, contentVersion });
    if (listed) for (const tagId of project.tagIds) await bumpListedCount(ctx, tagId, 1);
    await syncListedCopies(ctx, project._id, "projectTags", null);
    await syncListedCopies(ctx, project._id, "favorites", null);
    await audit(ctx, "project.restored", viewer, project, now);
    await outbox(ctx, project._id, listed ? "upsert" : "remove", contentVersion, now);
    return { ok: true, slug: project.slug };
  },
});

export const purge = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }): Promise<LifecycleResult> => {
    const viewer = await getViewer(ctx);
    const project = await loadProject(ctx, projectId);
    // Only from deleted, and only the owner or an admin (P07 §5.11).
    if (!viewer || !project || project.status !== "deleted" || (project.ownerId !== viewer.userId && viewer.role !== "admin")) {
      return { ok: false, code: "not_found" };
    }
    await purgeProjectNow(ctx, project, viewer, Date.now());
    return { ok: true, slug: project.slug };
  },
});

/**
 * The one purge path (P07 §5.11): audit, outbox remove, the project row, then
 * its related rows in batches and its files through deleteStoredFile. Used by
 * the owner's purge above and by the account-deletion purge (D04d), which
 * also purges active projects. Callers have checked who may do this.
 */
export async function purgeProjectNow(ctx: MutationCtx, project: Doc<"projects">, actor: Viewer | null, now: number) {
  await audit(ctx, "project.purged", actor, project, now);
  await outbox(ctx, project._id, "remove", project.contentVersion + 1, now);
  // A deleted project is unlisted, so its tag counters were already taken
  // down at soft delete. A listed one (account purge) gives them back here.
  if (project.listed) for (const tagId of project.tagIds) await bumpListedCount(ctx, tagId, -1);
  await ctx.db.delete(project._id);
  await purgeRelated(ctx, project._id);
}

// ---------------------------------------------------------------------------
// Fan-out

type CopyTable = "projectTags" | "favorites";

/**
 * Copies the project's current `listed` onto one page of its projectTags or
 * favorites and schedules the next page. Each page reads the project again,
 * so a delete and a restore racing each other end on the project's final
 * state.
 */
export async function syncListedCopies(ctx: MutationCtx, projectId: Id<"projects">, table: CopyTable, cursor: string | null) {
  const project = await ctx.db.get(projectId);
  if (!project) return;
  const page =
    table === "projectTags"
      ? await ctx.db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", projectId)).paginate({ cursor, numItems: LIFECYCLE_BATCH })
      : await ctx.db.query("favorites").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).paginate({ cursor, numItems: LIFECYCLE_BATCH });
  for (const row of page.page) if (row.listed !== project.listed) await ctx.db.patch(row._id, { listed: project.listed });
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.projectLifecycle.syncListedCopiesPage, { projectId, table, cursor: page.continueCursor });
  }
}

export const syncListedCopiesPage = internalMutation({
  args: { projectId: v.id("projects"), table: v.union(v.literal("projectTags"), v.literal("favorites")), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { projectId, table, cursor }) => {
    await syncListedCopies(ctx, projectId, table, cursor);
  },
});

/**
 * Deletes up to LIFECYCLE_BATCH rows that belong to a purged project and
 * schedules itself again while any are left. Image files are handed to
 * deleteStoredFile once their row is gone.
 */
async function purgeRelated(ctx: MutationCtx, projectId: Id<"projects">) {
  let budget = LIFECYCLE_BATCH;
  const take = async <T extends { _id: Id<TableNames> }>(rows: (n: number) => Promise<T[]>, each?: (row: T) => Promise<void>) => {
    if (budget <= 0) return;
    for (const row of await rows(budget)) {
      await ctx.db.delete(row._id);
      if (each) await each(row);
      budget--;
    }
  };
  await take((n) => ctx.db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", projectId)).take(n));
  await take((n) => ctx.db.query("favorites").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).take(n));
  await take((n) => ctx.db.query("projectSlugs").withIndex("by_project_state", (q) => q.eq("projectId", projectId)).take(n));
  await take((n) => ctx.db.query("tagSuggestions").withIndex("by_project_status", (q) => q.eq("projectId", projectId)).take(n));
  await take(
    (n) => ctx.db.query("projectImages").withIndex("by_project_status_order", (q) => q.eq("projectId", projectId)).take(n),
    async (image) => {
      await ctx.scheduler.runAfter(0, internal.projectLifecycle.deleteStoredFile, { storageId: image.storageId, attempt: 1 });
    },
  );
  // Out of budget: there may be more; the next batch finds out.
  if (budget <= 0) {
    await ctx.scheduler.runAfter(0, internal.projectLifecycle.purgeRelatedBatch, { projectId });
  }
}

export const purgeRelatedBatch = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    // The project row is gone before the first batch; if it exists, this is
    // not a purge (IDs are never reused), so do nothing.
    if (await ctx.db.get(projectId)) return;
    await purgeRelated(ctx, projectId);
  },
});

/** True when nothing still points at the file: no image row and no stored avatar. */
export const fileStillReferenced = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const image = await ctx.db.query("projectImages").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first();
    return { referenced: image !== null, exists: (await ctx.db.system.get(storageId)) !== null };
  },
});

/**
 * Deletes one stored file after its image row was purged. A file that is
 * already gone counts as done; one that is referenced again is left alone. A
 * failure is retried with backoff up to FILE_DELETE_MAX_ATTEMPTS, then logged
 * for the orphan sweep (P07 §3.10) to pick up.
 */
export const deleteStoredFile = internalAction({
  args: { storageId: v.id("_storage"), attempt: v.number() },
  handler: async (ctx, { storageId, attempt }): Promise<"deleted" | "missing" | "referenced" | "retrying" | "gave_up"> => {
    const { referenced, exists } = await ctx.runQuery(internal.projectLifecycle.fileStillReferenced, { storageId });
    if (referenced) return "referenced";
    if (!exists) return "missing";
    try {
      await ctx.storage.delete(storageId);
      return "deleted";
    } catch (error) {
      if (attempt >= FILE_DELETE_MAX_ATTEMPTS) {
        console.error(`deleteStoredFile: giving up on ${storageId} after ${attempt} attempts`, error);
        return "gave_up";
      }
      await ctx.scheduler.runAfter(fileDeleteRetryDelayMs(attempt), internal.projectLifecycle.deleteStoredFile, { storageId, attempt: attempt + 1 });
      return "retrying";
    }
  },
});
