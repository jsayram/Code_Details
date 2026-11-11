// D07 (P08 R30): the one writer of project-tag membership. Project create and
// update and the admin's approval of a suggestion all go through
// setProjectTags, so the join rows, projects.tagIds/tagCount (the join's
// copy) and each tag's listedProjectCount always move together. The lifecycle
// and account-deletion code only copy `listed` onto existing rows
// (syncListedCopies); the importer and fixtures load data and are not writers
// at runtime. No Convex functions here, only helpers.
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export async function bumpListedCount(ctx: MutationCtx, tagId: Id<"tags">, by: 1 | -1) {
  const tag = await ctx.db.get(tagId);
  if (tag) await ctx.db.patch(tagId, { listedProjectCount: Math.max(0, tag.listedProjectCount + by) });
}

/**
 * Replaces the project's tags with `tagIds` (in order, already deduplicated):
 * join rows, the tagIds/tagCount copy, and the listed counters when the
 * project is listed. Callers own contentVersion, updatedAt and the outbox.
 */
export async function setProjectTags(ctx: MutationCtx, project: Doc<"projects">, tagIds: Id<"tags">[]): Promise<void> {
  const old = await ctx.db
    .query("projectTags")
    .withIndex("by_project_position", (q) => q.eq("projectId", project._id))
    .collect();
  for (const row of old) await ctx.db.delete(row._id);
  for (const [position, tagId] of tagIds.entries()) {
    await ctx.db.insert("projectTags", { projectId: project._id, tagId, position, listed: project.listed });
  }
  if (project.listed) {
    const before = new Set(project.tagIds);
    const after = new Set(tagIds);
    for (const tagId of before) if (!after.has(tagId)) await bumpListedCount(ctx, tagId, -1);
    for (const tagId of after) if (!before.has(tagId)) await bumpListedCount(ctx, tagId, 1);
  }
  await ctx.db.patch(project._id, { tagIds, tagCount: tagIds.length });
}
