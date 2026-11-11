// D09 S02a: keeps projects.searchText, the field the search_public index
// reads, equal to the S00.2 projection plus the vocabulary layer. Rebuilt from
// the stored project, its owner's profile and its tags, never from a caller's
// arguments, and in the same transaction as the change: a project that stops
// being listed loses its searchText before the mutation commits, so it can't
// be found even for a moment. Callers: the project outbox helper (every
// project change and every listed flip), the project update, the profile
// renames by the owner and by an admin, and the fixtures. The importer leaves
// searchText unset; backfillBatch fills it afterwards.
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { toPublicSearchDoc } from "../src/backend/search/public-search-doc";
import { extendText } from "../src/backend/search/vocabulary-layer";

/** The searchText a project should have now, or undefined when it must not be searchable. */
export async function searchTextFor(ctx: MutationCtx, project: Doc<"projects">): Promise<string | undefined> {
  const profile = await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", project.ownerId)).first();
  const owner = await ctx.db.get(project.ownerId);
  const tags: { id: string; name: string; status: "active" | "retired" }[] = [];
  for (const tagId of project.tagIds) {
    const tag = await ctx.db.get(tagId);
    if (tag) tags.push({ id: tag._id, name: tag.name, status: tag.status });
  }
  const doc = toPublicSearchDoc(
    { ...project, id: project._id },
    profile && owner?.status === "active" ? { username: profile.username, fullName: profile.fullName ?? null } : null,
    tags,
  );
  return doc ? extendText(doc.searchText) : undefined;
}

/** Rebuilds one project's searchText; a missing project (purged) is left alone. */
export async function syncSearchText(ctx: MutationCtx, projectId: Id<"projects">): Promise<void> {
  const project = await ctx.db.get(projectId);
  if (!project) return;
  const next = await searchTextFor(ctx, project);
  if (next !== project.searchText) await ctx.db.patch(projectId, { searchText: next });
}

/** Owner names are in every project's searchText: a profile change rebuilds all of the owner's active projects. */
export async function syncOwnerSearchText(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_owner_status_created", (q) => q.eq("ownerId", userId).eq("status", "active"))
    .collect();
  for (const p of projects) await syncSearchText(ctx, p._id);
}

/**
 * Fills searchText for existing projects, 100 at a time, after an import or
 * when the projection or vocabulary version changes. Internal: run with
 * `npx convex run searchSync:backfillBatch` (admin key) until isDone.
 */
export const backfillBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("projects").paginate({ cursor, numItems: 100 });
    for (const p of page.page) await syncSearchText(ctx, p._id);
    return { synced: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});
