// Public project read on Convex (Phase C, C10). Returns the C02 contract,
// built and checked with the same module the Supabase reader uses, so the two
// backends can't drift apart in shape. Anonymous by design: no identity
// argument, and it never returns users, emails or provider subjects.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { getViewer } from "./viewer";
import type { Doc } from "./_generated/dataModel";
import {
  type PublicProject,
  type PublicProjectOwner,
  assertPublicProject,
  publicCategoryData,
  publicLinks,
} from "../src/backend/projects/public-project";

const iso = (ms: number) => new Date(ms).toISOString();

export const getPublicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<PublicProject | null> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    // Private, deleted and missing all look the same. `listed` is derived, so
    // status and visibility are checked too in case a writer got it wrong.
    if (!project || !project.listed || project.status !== "active" || project.visibility !== "public") return null;

    const tags: string[] = [];
    for (const id of project.tagIds) {
      const tag = await ctx.db.get(id);
      if (tag && tag.status === "active") tags.push(tag.name);
    }

    let owner: PublicProjectOwner | null = null;
    const user = await ctx.db.get(project.ownerId);
    // P07 §8: a profile is public unless the account is deleting or deleted.
    if (user && user.status === "active") {
      const profile: Doc<"profiles"> | null = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first();
      if (profile) {
        let avatarUrl: string | null = null;
        if (profile.avatar?.kind === "external") avatarUrl = profile.avatar.url;
        else if (profile.avatar?.kind === "stored") avatarUrl = await ctx.storage.getUrl(profile.avatar.storageId);
        owner = { username: profile.username, fullName: profile.fullName ?? null, avatarUrl };
      }
    }

    const fieldOrder = project.fieldOrder ?? null;
    const result: PublicProject = {
      id: project._id,
      slug: project.slug,
      title: project.title,
      description: project.description ?? null,
      category: project.category,
      tags,
      links: publicLinks(project.links),
      categoryData: publicCategoryData(project.categoryData, fieldOrder),
      fieldOrder,
      favoriteCount: project.favoriteCount,
      visibility: "public",
      listed: true,
      createdAt: iso(project.createdAt),
      updatedAt: iso(project.updatedAt),
      owner,
    };
    assertPublicProject(result);
    return result;
  },
});

/**
 * D01: the owner's own view of one project, private or deleted included. The
 * owner comes from the session, never from an argument; anyone else, signed
 * in or not, gets null, the same answer as for a missing slug. A minimal
 * shape for now: D02r builds the owner reads on this check.
 */
export const getOwnBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!project || project.ownerId !== viewer.userId) return null;
    return {
      id: project._id,
      slug: project.slug,
      title: project.title,
      visibility: project.visibility,
      status: project.status,
      listed: project.listed,
    };
  },
});
