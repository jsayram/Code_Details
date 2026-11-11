// D05: favorite and unfavorite (P07 §3.9, §5.10, §8; P08 R02, R25, R31). Two
// separate operations; each takes the caller from getViewer only, never from
// an argument. A project the caller may not favorite gets not_found, the same
// answer as a missing or malformed ID.
//
// - The counters move only when a favorite row is really inserted or deleted,
//   in the same transaction: favoriteCount for every row, rankingFavoriteCount
//   only when the caller isn't the owner (self-favorites are allowed but don't
//   count for popularity). Repeats are no-ops; Convex retries conflicting
//   concurrent mutations, so a double click can't insert twice.
// - A favorite is not an edit: updatedAt and contentVersion stay as they are
//   (a favorite mustn't reorder "recently updated" or make an open edit stale).
// - The row's listed copies the project's, so a private or deleted project
//   never shows in "my favorites".
// - Both counters are in the public search projection (P07 §5.14), so a
//   listed project gets a contentChanges upsert at its current contentVersion.
//   There is no favorite audit kind; the row's createdAt is the record.
import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getViewer } from "./viewer";
import { outbox } from "./projectLifecycle";
import { attributeFavorite } from "./searchAnalytics";

export type FavoriteResult = { ok: true; isFavorite: boolean; favoriteCount: number } | { ok: false; code: "not_found" };

async function loadProject(ctx: MutationCtx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  return id ? await ctx.db.get(id) : null;
}

async function countersChanged(ctx: MutationCtx, project: Doc<"projects">, delta: 1 | -1, selfFavorite: boolean) {
  const favoriteCount = Math.max(0, project.favoriteCount + delta);
  await ctx.db.patch(project._id, {
    favoriteCount,
    ...(!selfFavorite && { rankingFavoriteCount: Math.max(0, project.rankingFavoriteCount + delta) }),
  });
  if (project.listed) await outbox(ctx, project._id, "upsert", project.contentVersion, Date.now());
  return favoriteCount;
}

export const add = mutation({
  // D10: `search` names the search result the favorite came from (its receipt
  // and the browser's random visit token, never a person). Optional; it only
  // feeds analytics, and only after a validated click (attributeFavorite).
  args: { projectId: v.string(), search: v.optional(v.object({ receiptId: v.string(), visit: v.string() })) },
  handler: async (ctx, { projectId, search }): Promise<FavoriteResult> => {
    const viewer = await getViewer(ctx);
    const project = await loadProject(ctx, projectId);
    // Active, and listed unless it's the caller's own (private) project.
    if (!viewer || !project || project.status !== "active" || (!project.listed && project.ownerId !== viewer.userId)) {
      return { ok: false, code: "not_found" };
    }
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_project", (q) => q.eq("userId", viewer.userId).eq("projectId", project._id))
      .unique();
    if (existing) return { ok: true, isFavorite: true, favoriteCount: project.favoriteCount };
    await ctx.db.insert("favorites", { userId: viewer.userId, projectId: project._id, createdAt: Date.now(), listed: project.listed });
    const favoriteCount = await countersChanged(ctx, project, 1, project.ownerId === viewer.userId);
    if (search && project.listed) await attributeFavorite(ctx, search, project._id);
    return { ok: true, isFavorite: true, favoriteCount };
  },
});

export const remove = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }): Promise<FavoriteResult> => {
    const viewer = await getViewer(ctx);
    const project = await loadProject(ctx, projectId);
    if (!viewer || !project) return { ok: false, code: "not_found" };
    // Works on a deleted or private project too: the caller's own row is theirs to drop.
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_project", (q) => q.eq("userId", viewer.userId).eq("projectId", project._id))
      .unique();
    if (!existing) {
      // Don't confirm a hidden project exists to someone who never favorited it.
      if (project.status !== "active" || (!project.listed && project.ownerId !== viewer.userId)) return { ok: false, code: "not_found" };
      return { ok: true, isFavorite: false, favoriteCount: project.favoriteCount };
    }
    await ctx.db.delete(existing._id);
    const favoriteCount = await countersChanged(ctx, project, -1, project.ownerId === viewer.userId);
    return { ok: true, isFavorite: false, favoriteCount };
  },
});
