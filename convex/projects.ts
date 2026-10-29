// Public project read on Convex (Phase C, C10). Returns the C02 contract,
// built and checked with the same module the Supabase reader uses, so the two
// backends can't drift apart in shape. Anonymous by design: no identity
// argument, and it never returns users, emails or provider subjects.
import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { getViewer, type Viewer } from "./viewer";
import type { Doc, Id } from "./_generated/dataModel";
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

// ---------------------------------------------------------------------------
// D02r: personal reads (my projects, my graveyard, my favorites, their
// category counts). The caller comes from getViewer only; there is no
// identity argument, so A can never ask for B's lists, and anyone who isn't an
// active, linked user gets an empty answer. Rows carry no email, provider
// subject, role or tier; whether a row is the caller's own is a flag, never
// the owner's ID. Lists are bounded (personal sets are small); the route does
// the sorting and paging (D02r-c).

/** At most this many rows per personal list. */
export const PERSONAL_LIST_LIMIT = 500;

export interface PersonalProjectCard {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  visibility: "public" | "private";
  tags: string[];
  favoriteCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  owner: PublicProjectOwner | null;
  isMine: boolean;
  isFavorite: boolean;
}

async function activeTagNames(ctx: QueryCtx, project: Doc<"projects">): Promise<string[]> {
  const names: string[] = [];
  for (const id of project.tagIds) {
    const tag = await ctx.db.get(id);
    if (tag && tag.status === "active") names.push(tag.name);
  }
  return names;
}

/** The public owner fields (P07 §8), or null for a deleting/deleted account. */
async function publicOwner(ctx: QueryCtx, ownerId: Id<"users">): Promise<PublicProjectOwner | null> {
  const user = await ctx.db.get(ownerId);
  if (!user || user.status !== "active") return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first();
  if (!profile) return null;
  let avatarUrl: string | null = null;
  if (profile.avatar?.kind === "external") avatarUrl = profile.avatar.url;
  else if (profile.avatar?.kind === "stored") avatarUrl = await ctx.storage.getUrl(profile.avatar.storageId);
  return { username: profile.username, fullName: profile.fullName ?? null, avatarUrl };
}

async function isFavoriteOf(ctx: QueryCtx, userId: Id<"users">, projectId: Id<"projects">): Promise<boolean> {
  const row = await ctx.db
    .query("favorites")
    .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
    .first();
  return row !== null;
}

async function toCard(ctx: QueryCtx, viewer: Viewer, project: Doc<"projects">, isFavorite?: boolean): Promise<PersonalProjectCard> {
  return {
    id: project._id,
    slug: project.slug,
    title: project.title,
    description: project.description ?? null,
    category: project.category,
    visibility: project.visibility,
    tags: await activeTagNames(ctx, project),
    favoriteCount: project.favoriteCount,
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
    deletedAt: project.status === "deleted" && project.deletedAt !== undefined ? iso(project.deletedAt) : null,
    owner: await publicOwner(ctx, project.ownerId),
    isMine: project.ownerId === viewer.userId,
    isFavorite: isFavorite ?? (await isFavoriteOf(ctx, viewer.userId, project._id)),
  };
}

async function ownProjects(ctx: QueryCtx, viewer: Viewer, status: "active" | "deleted") {
  return ctx.db
    .query("projects")
    .withIndex("by_owner_status_created", (q) => q.eq("ownerId", viewer.userId).eq("status", status))
    .order("desc")
    .take(PERSONAL_LIST_LIMIT);
}

/** Favorited projects that are listed (deleted and private ones are left out), newest favorite first. */
async function favoriteProjects(ctx: QueryCtx, viewer: Viewer) {
  const rows = await ctx.db
    .query("favorites")
    .withIndex("by_user_listed_created", (q) => q.eq("userId", viewer.userId).eq("listed", true))
    .order("desc")
    .take(PERSONAL_LIST_LIMIT);
  const out: Doc<"projects">[] = [];
  for (const row of rows) {
    const project = await ctx.db.get(row.projectId);
    // listed is a copy; check the project itself too, as getPublicBySlug does.
    if (project && project.listed && project.status === "active" && project.visibility === "public") out.push(project);
  }
  return out;
}

/** My projects: the caller's own active projects, private ones included, newest first. */
export const listMine = query({
  args: {},
  handler: async (ctx): Promise<PersonalProjectCard[]> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const projects = await ownProjects(ctx, viewer, "active");
    return Promise.all(projects.map((p) => toCard(ctx, viewer, p)));
  },
});

/** My graveyard: the caller's own deleted projects, newest first. */
export const listMyDeleted = query({
  args: {},
  handler: async (ctx): Promise<PersonalProjectCard[]> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const projects = await ownProjects(ctx, viewer, "deleted");
    return Promise.all(projects.map((p) => toCard(ctx, viewer, p)));
  },
});

/** My favorites: private to the caller (P07 §8). */
export const listMyFavorites = query({
  args: {},
  handler: async (ctx): Promise<PersonalProjectCard[]> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const projects = await favoriteProjects(ctx, viewer);
    return Promise.all(projects.map((p) => toCard(ctx, viewer, p, true)));
  },
});

/** Category counts for one of the caller's personal views; {} for anyone not signed in. */
export const myCategoryCounts = query({
  args: { view: v.union(v.literal("mine"), v.literal("favorites"), v.literal("deleted")) },
  handler: async (ctx, { view }): Promise<Record<string, number>> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return {};
    const projects =
      view === "favorites"
        ? await favoriteProjects(ctx, viewer)
        : await ownProjects(ctx, viewer, view === "deleted" ? "deleted" : "active");
    const counts: Record<string, number> = {};
    for (const p of projects) counts[p.category] = (counts[p.category] ?? 0) + 1;
    return counts;
  },
});
