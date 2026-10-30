// Public project read on Convex (Phase C, C10). Returns the C02 contract,
// built and checked with the same module the Supabase reader uses, so the two
// backends can't drift apart in shape. Anonymous by design: no identity
// argument, and it never returns users, emails or provider subjects.
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getViewer, type Viewer } from "./viewer";
import { setProjectTags } from "./tagWriter";
import type { Doc, Id } from "./_generated/dataModel";
import {
  CATEGORY_FIELDS_VERSION,
  type Issue,
  checkCategoryData,
  normalizeProjectPatch,
  tagNameKey,
  titleSortKey,
} from "../src/backend/projects/project-update-rules";
import { pageRows, sortRows } from "../src/backend/projects/list-rules";
import { usernameKey } from "../src/backend/profiles/public-profile";
import {
  PUBLIC_PROJECT_VERSION,
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

async function toCard(ctx: QueryCtx, viewer: Viewer | null, project: Doc<"projects">, isFavorite?: boolean): Promise<PersonalProjectCard> {
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
    isMine: viewer !== null && project.ownerId === viewer.userId,
    isFavorite: isFavorite ?? (viewer !== null && (await isFavoriteOf(ctx, viewer.userId, project._id))),
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

// ---------------------------------------------------------------------------
// D07x: the public lists (the community list and its category, tag and
// portfolio variants). Listed projects only, with the getPublicBySlug check
// repeated on each row, so private and deleted projects never appear. No
// identity argument: the viewer, when there is one, only sets isMine and
// isFavorite. The filters, sorts and paging match /api/projects on Supabase
// (list-rules.ts); only the returned page is turned into cards.

/** At most this many listed projects are considered per request. */
export const PUBLIC_LIST_SCAN_LIMIT = 1000;
const MAX_PAGE_SIZE = 100;

const isPublic = (p: Doc<"projects">) => p.listed && p.status === "active" && p.visibility === "public";

/** The active, listed projects of the account behind a handle, or null when nobody holds it. */
async function listedOf(ctx: QueryCtx, handle: string): Promise<Doc<"projects">[] | null> {
  if (handle.length > 100) return null;
  const key = usernameKey(handle);
  if (!key) return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_usernameKey", (q) => q.eq("usernameKey", key))
    .first();
  if (!profile) return null;
  const user = await ctx.db.get(profile.userId);
  if (!user || user.status !== "active") return null;
  return ctx.db
    .query("projects")
    .withIndex("by_owner_listed_created", (q) => q.eq("ownerId", user._id).eq("listed", true))
    .order("desc")
    .take(PUBLIC_LIST_SCAN_LIMIT);
}

/**
 * Tag filter as Supabase applies it: the names that match an active tag must
 * all be on the project; names that match no tag are ignored, and when none
 * match the list is empty.
 */
async function tagFilter(ctx: QueryCtx, names: string[]): Promise<((p: Doc<"projects">) => boolean) | "none" | null> {
  if (names.length === 0) return null;
  const ids: Id<"tags">[] = [];
  for (const name of names.slice(0, 20)) {
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_nameKey", (q) => q.eq("nameKey", tagNameKey(name)))
      .first();
    if (tag && tag.status === "active") ids.push(tag._id);
  }
  if (ids.length === 0) return "none";
  return (p) => ids.every((id) => p.tagIds.includes(id));
}

export const listPublic = query({
  args: {
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    // The owner's public handle (a portfolio), named as getPublicByUsername
    // names it; a filter on public data, never the caller.
    handle: v.optional(v.string()),
    sortBy: v.string(),
    page: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<{ cards: PersonalProjectCard[]; total: number }> => {
    const empty = { cards: [], total: 0 };
    const page = Number.isFinite(args.page) ? Math.max(1, Math.floor(args.page)) : 1;
    const limit = Number.isFinite(args.limit) ? Math.min(MAX_PAGE_SIZE, Math.max(0, Math.floor(args.limit))) : MAX_PAGE_SIZE;

    let projects: Doc<"projects">[];
    if (args.handle !== undefined) {
      const own = await listedOf(ctx, args.handle);
      if (!own) return empty;
      projects = own;
    } else {
      projects = await ctx.db
        .query("projects")
        .withIndex("by_listed_created", (q) => q.eq("listed", true))
        .order("desc")
        .take(PUBLIC_LIST_SCAN_LIMIT);
    }

    const byTags = await tagFilter(ctx, args.tags ?? []);
    if (byTags === "none") return empty;
    const category = args.category && args.category !== "all" ? args.category : null;
    const matching = projects.filter((p) => isPublic(p) && (!category || p.category === category) && (!byTags || byTags(p)));

    const sorted = sortRows(matching, args.sortBy, (p) => ({
      id: p._id,
      title: p.title,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      favoriteCount: p.favoriteCount,
      tagCount: p.tagIds.length,
    }));
    // Page 0 rows "all" is capped too, so one request never builds more than a page of cards.
    const { rows, total } = pageRows(sorted, page, limit === 0 ? MAX_PAGE_SIZE : limit);
    const viewer = await getViewer(ctx);
    return { cards: await Promise.all(rows.map((p) => toCard(ctx, viewer, p))), total };
  },
});

// ---------------------------------------------------------------------------
// D02: the project update (P07 §4 "one mutation", P08 R27–R29). The caller
// comes from getViewer only; the arguments name the project, the version the
// caller read and the fields to change, never a user. The mutation is the
// transaction: every check runs before the first write, so a refused update
// writes nothing, and an accepted one writes the project, its tags, its slug
// history, the tag counters, the audit row and the search outbox together.

/** The owner's edit view of a project: no email, provider subject, role, tier or owner ID. */
export interface EditableProject {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  categoryData: Record<string, string | number | boolean | string[]> | null;
  fieldOrder: string[] | null;
  links: { url: string; label?: string; type?: string }[];
  tags: string[];
  favoriteCount: number;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
  contentVersion: number;
  owner: PublicProjectOwner | null;
}

export type UpdateResult =
  | { ok: true; project: EditableProject; previousSlug: string | null }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "stale"; contentVersion: number }
  | { ok: false; code: "invalid"; issues: Issue[] };

export async function toEditable(ctx: QueryCtx, project: Doc<"projects">): Promise<EditableProject> {
  return {
    id: project._id,
    slug: project.slug,
    title: project.title,
    description: project.description ?? null,
    category: project.category,
    categoryData: project.categoryData ?? null,
    fieldOrder: project.fieldOrder ?? null,
    links: project.links,
    tags: await activeTagNames(ctx, project),
    favoriteCount: project.favoriteCount,
    visibility: project.visibility,
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
    contentVersion: project.contentVersion,
    owner: await publicOwner(ctx, project.ownerId),
  };
}

/** The caller's own active project, or null (missing, deleted or someone else's all look the same). */
async function ownActiveProject(ctx: QueryCtx, viewer: Viewer | null, project: Doc<"projects"> | null) {
  if (!viewer || !project || project.ownerId !== viewer.userId || project.status !== "active") return null;
  return project;
}

/**
 * D02: the owner's own project for the edit page, with the contentVersion the
 * save must send back. `viewerAuthSubject` is the caller's own token subject:
 * the page hands it to ProjectContent, whose owner check compares the
 * session's user ID with the profile's. Null for anyone else.
 */
export const getMineForEdit = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<(EditableProject & { viewerAuthSubject: string }) | null> => {
    const viewer = await getViewer(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    const own = await ownActiveProject(ctx, viewer, project);
    if (!own || !identity) return null;
    return { ...(await toEditable(ctx, own)), viewerAuthSubject: identity.subject };
  },
});

/**
 * D02 (R28): where an old slug points now. The current slug of the project
 * that used to have it, when that project is listed or the caller owns it;
 * null otherwise (unknown, current already, private, deleted).
 */
export const currentSlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<string | null> => {
    const row = await ctx.db
      .query("projectSlugs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!row || row.state !== "previous") return null;
    const project = await ctx.db.get(row.projectId);
    if (!project || project.slug === slug) return null;
    if (project.listed) return project.slug;
    return (await ownActiveProject(ctx, await getViewer(ctx), project))?.slug ?? null;
  },
});

export const categoryValue = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()));

export const update = mutation({
  args: {
    // A string, not v.id: a malformed or foreign ID gets the same not_found as
    // someone else's project instead of a validator error that tells them apart.
    projectId: v.string(),
    expectedContentVersion: v.number(),
    // Closed: any other key (ownerId, status, visibility, listed, counters,
    // contentVersion, timestamps...) is refused before the handler runs.
    patch: v.object({
      title: v.optional(v.string()),
      slug: v.optional(v.string()),
      description: v.optional(v.union(v.string(), v.null())),
      category: v.optional(v.string()),
      links: v.optional(v.array(v.object({ url: v.string(), label: v.optional(v.string()), type: v.optional(v.string()) }))),
      tags: v.optional(v.array(v.string())),
      categoryData: v.optional(v.union(v.record(v.string(), categoryValue), v.null())),
      fieldOrder: v.optional(v.union(v.array(v.string()), v.null())),
    }),
  },
  handler: async (ctx, { projectId, expectedContentVersion, patch }): Promise<UpdateResult> => {
    const viewer = await getViewer(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const project = await ownActiveProject(ctx, viewer, id ? await ctx.db.get(id) : null);
    if (!viewer || !project) return { ok: false, code: "not_found" };
    if (project.contentVersion !== expectedContentVersion) {
      return { ok: false, code: "stale", contentVersion: project.contentVersion };
    }

    // ---- Checks (no writes) ----
    const { value, issues } = normalizeProjectPatch(patch, project.category);
    if (value.category !== undefined && value.category !== project.category && patch.categoryData === undefined) {
      // A category change without new details: the stored details must fit the new category.
      issues.push(...checkCategoryData(value.category, project.categoryData, project.fieldOrder, { strictKeys: true }));
    }
    const slugChanges = value.slug !== undefined && value.slug !== project.slug;
    if (slugChanges && (await slugTaken(ctx, value.slug!, project._id))) {
      issues.push({ field: "slug", message: "This slug is already taken" });
    }
    const resolved = await resolveTags(ctx, value.tags ?? [], issues);
    if (issues.length) return { ok: false, code: "invalid", issues };

    // ---- Writes ----
    const now = Date.now();
    const contentVersion = project.contentVersion + 1;
    const doc: Partial<Doc<"projects">> = { contentVersion, updatedAt: now };
    if (value.title !== undefined) {
      doc.title = value.title;
      doc.titleSortKey = titleSortKey(value.title);
    }
    if (value.description !== undefined) doc.description = value.description ?? undefined;
    if (value.category !== undefined) doc.category = value.category;
    if (value.links !== undefined) doc.links = value.links;
    if (value.categoryData !== undefined) {
      doc.categoryData = value.categoryData ?? undefined;
      doc.categoryDataVersion = value.categoryData ? CATEGORY_FIELDS_VERSION : undefined;
    }
    if (value.fieldOrder !== undefined) doc.fieldOrder = value.fieldOrder ?? undefined;

    if (value.tags !== undefined) {
      // D07: the one membership writer (convex/tagWriter.ts); it patches tagIds/tagCount itself.
      await setProjectTags(ctx, project, await createMissingTags(ctx, resolved, now));
    }

    if (slugChanges) {
      const slug = value.slug!;
      const rows = await ctx.db
        .query("projectSlugs")
        .withIndex("by_project_state", (q) => q.eq("projectId", project._id))
        .collect();
      for (const row of rows) if (row.state === "current") await ctx.db.patch(row._id, { state: "previous" });
      if (!rows.some((r) => r.slug === project.slug)) {
        // A project with no history yet: its old slug is kept as previous.
        await ctx.db.insert("projectSlugs", { slug: project.slug, projectId: project._id, state: "previous", createdAt: project.createdAt });
      }
      const again = rows.find((r) => r.slug === slug);
      if (again) await ctx.db.patch(again._id, { state: "current" });
      else await ctx.db.insert("projectSlugs", { slug, projectId: project._id, state: "current", createdAt: now });
      doc.slug = slug;
      await ctx.db.insert("auditEvents", {
        kind: "slug.changed",
        actorId: viewer.userId,
        subjectTable: "projects",
        subjectId: project._id,
        at: now,
        details: { from: project.slug, to: slug },
      });
    }

    await ctx.db.patch(project._id, doc);
    await ctx.db.insert("contentChanges", {
      entityType: "project",
      entityId: project._id,
      change: project.listed ? "upsert" : "remove",
      sourceVersion: contentVersion,
      projectionVersion: PUBLIC_PROJECT_VERSION,
      createdAt: now,
      attempts: 0,
    });
    const saved = (await ctx.db.get(project._id))!;
    return { ok: true, project: await toEditable(ctx, saved), previousSlug: slugChanges ? project.slug : null };
  },
});

/**
 * True when another project holds this slug: as its current slug, or in its
 * history (a slug stays reserved until its project is purged, P07 §3.6).
 * `ownProjectId` is the project asking (null for a new one).
 */
export async function slugTaken(ctx: QueryCtx, slug: string, ownProjectId: Id<"projects"> | null): Promise<boolean> {
  const held = await ctx.db
    .query("projectSlugs")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .collect();
  const live = await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  return held.some((r) => r.projectId !== ownProjectId) || (live !== null && live._id !== ownProjectId);
}

export type ResolvedTag = { nameKey: string; name: string; tag: Doc<"tags"> | null };

/** Finds each (deduplicated) tag by nameKey; a retired one is an issue. No writes. */
export async function resolveTags(ctx: QueryCtx, tags: { nameKey: string; name: string }[], issues: Issue[]): Promise<ResolvedTag[]> {
  const resolved: ResolvedTag[] = [];
  for (const t of tags) {
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_nameKey", (q) => q.eq("nameKey", t.nameKey))
      .first();
    if (tag?.status === "retired") issues.push({ field: "tags", message: `The tag "${tag.name}" is retired` });
    resolved.push({ ...t, tag });
  }
  return resolved;
}

/** The tag IDs in order, creating the tags that don't exist yet (active, count 0). */
export async function createMissingTags(ctx: MutationCtx, resolved: ResolvedTag[], now: number): Promise<Id<"tags">[]> {
  const tagIds: Id<"tags">[] = [];
  for (const r of resolved) {
    tagIds.push(
      r.tag?._id ??
        (await ctx.db.insert("tags", { name: r.name, nameKey: r.nameKey, status: "active", listedProjectCount: 0, createdAt: now })),
    );
  }
  return tagIds;
}

// D07: moved to convex/tagWriter.ts with the membership writer; re-exported for the lifecycle code.
export { bumpListedCount } from "./tagWriter";
