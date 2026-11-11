// D07: tags, tag suggestions and their moderation on Convex (P07 §3.7, §3.8,
// §3.11; P08 R04, R30). Identity only from getViewer; no function takes a
// user argument. Rules, the same as the default path after D07-a:
// - Lookup is public and returns active tags only.
// - A suggestion's submitter is the viewer. The project's owner adds an
//   existing tag directly, within MAX_PROJECT_TAGS. Anyone else's suggestion,
//   and any brand-new tag, stays pending for an admin. Non-owners suggest only
//   on listed projects; hidden, deleted and missing projects look the same.
// - Approve and reject are for users.role === "admin"; anyone else gets
//   not_found. Approval attaches through the one membership writer
//   (tagWriter.ts) and settles the other pending suggestions of the same tag.
// - Names are matched by nameKey (tagNameKey: trimmed, NFKC, lowercased, single
//   spaces), then by reviewed alias. A brand-new tag follows the suggestion
//   name rule (lowercase letters, digits and single hyphens).
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewer, type Viewer } from "./viewer";
import { setProjectTags } from "./tagWriter";
import { outbox } from "./projectLifecycle";
import { dedupeTags, type Issue } from "../src/backend/projects/project-update-rules";
import {
  MAX_ADMIN_NOTES_LENGTH,
  MAX_PROJECT_TAGS,
  MAX_TAG_DESCRIPTION_LENGTH,
  MIN_TAG_NAME_LENGTH,
} from "../src/constants/project-limits";

const SEARCH_LIMIT = 50;
/** Pending suggestions one account may have open at once. */
export const MAX_PENDING_PER_USER = 25;
/** Other pending suggestions of the same tag settled by one approval. */
const SETTLE_BATCH = 100;
const NEW_TAG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

type Refused = { ok: false; code: "not_found" } | { ok: false; code: "invalid"; issues: Issue[] };
export type SuggestResult =
  | { ok: true; status: "already" | "attached" | "pending" }
  | Refused
  | { ok: false; code: "duplicate" | "too_many_pending" };
export type ModerateResult = { ok: true } | Refused | { ok: false; code: "not_pending" | "limit" };

const invalid = (message: string, field = "tags"): Refused => ({ ok: false, code: "invalid", issues: [{ field, message }] });

/** The tag a nameKey names: by its own key, else by a reviewed alias. */
async function tagByKey(ctx: QueryCtx, nameKey: string): Promise<Doc<"tags"> | null> {
  const tag = await ctx.db.query("tags").withIndex("by_nameKey", (q) => q.eq("nameKey", nameKey)).first();
  if (tag) return tag;
  const alias = await ctx.db.query("tagAliases").withIndex("by_aliasKey", (q) => q.eq("aliasKey", nameKey)).first();
  return alias ? await ctx.db.get(alias.tagId) : null;
}

/** Adds one tag through the membership writer; a tag change is a content change (stale-edit check, outbox). */
async function attachTag(ctx: MutationCtx, project: Doc<"projects">, tagId: Id<"tags">, now: number) {
  await setProjectTags(ctx, project, [...project.tagIds, tagId]);
  const contentVersion = project.contentVersion + 1;
  await ctx.db.patch(project._id, { contentVersion });
  await outbox(ctx, project._id, project.listed ? "upsert" : "remove", contentVersion, now);
}

async function adminViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const viewer = await getViewer(ctx);
  return viewer?.role === "admin" ? viewer : null;
}

// ---------------------------------------------------------------------------
// Lookup (public)

/** Active tags whose nameKey starts with the query, or the most used ones for an empty query. */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, { query: q }): Promise<{ name: string; listedProjectCount: number }[]> => {
    const key = q.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ").slice(0, 100);
    const rows = key
      ? await ctx.db
          .query("tags")
          .withIndex("by_status_name", (i) => i.eq("status", "active").gte("nameKey", key).lt("nameKey", key + "￿"))
          .take(SEARCH_LIMIT)
      : await ctx.db
          .query("tags")
          .withIndex("by_status_count", (i) => i.eq("status", "active"))
          .order("desc")
          .take(SEARCH_LIMIT);
    return rows.map((t) => ({ name: t.name, listedProjectCount: t.listedProjectCount }));
  },
});

/** At most this many tags in the full list (MAX_TAGS_QUERY_RESULTS on Supabase). */
const LIST_LIMIT = 500;

/**
 * D07x: every active tag with its listed-project count, most used first, for
 * the /tags page and the tag picker's cache (searchTagsAction's empty query
 * on Supabase). Public; counts cover listed projects only, so a private or
 * deleted project never shows through a count.
 */
export const listAll = query({
  args: {},
  handler: async (ctx): Promise<{ id: string; name: string; count: number }[]> => {
    const rows = await ctx.db
      .query("tags")
      .withIndex("by_status_count", (i) => i.eq("status", "active"))
      .order("desc")
      .take(LIST_LIMIT);
    return rows
      .map((t) => ({ id: t._id, name: t.name, count: t.listedProjectCount }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  },
});

// ---------------------------------------------------------------------------
// Suggestions (signed in)

export const suggest = mutation({
  args: { projectId: v.string(), name: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { projectId, name, note }): Promise<SuggestResult> => {
    const viewer = await getViewer(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const project = id ? await ctx.db.get(id) : null;
    if (!viewer || !project || project.status !== "active") return { ok: false, code: "not_found" };
    const isOwner = project.ownerId === viewer.userId;
    if (!isOwner && !project.listed) return { ok: false, code: "not_found" };

    const { tags, issues } = dedupeTags([name]);
    if (issues.length || tags.length !== 1) return { ok: false, code: "invalid", issues: issues.length ? issues : [{ field: "tags", message: "Enter a tag" }] };
    const trimmedNote = note?.trim() || undefined;
    if (trimmedNote && trimmedNote.length > MAX_TAG_DESCRIPTION_LENGTH) {
      return invalid(`Description must be at most ${MAX_TAG_DESCRIPTION_LENGTH} characters`, "note");
    }
    const { nameKey } = tags[0];

    const tag = await tagByKey(ctx, nameKey);
    if (tag?.status === "retired") return invalid(`The tag "${tag.name}" is retired`);
    if (tag && project.tagIds.includes(tag._id)) return { ok: true, status: "already" };
    if (tag && isOwner) {
      if (project.tagIds.length >= MAX_PROJECT_TAGS) return invalid(`Maximum ${MAX_PROJECT_TAGS} tags allowed`);
      await attachTag(ctx, project, tag._id, Date.now());
      return { ok: true, status: "attached" };
    }
    if (!tag) {
      if (nameKey.length < MIN_TAG_NAME_LENGTH || !NEW_TAG_RE.test(nameKey) || nameKey.includes("--")) {
        return invalid("Tag must be lowercase, alphanumeric with hyphens, and cannot start/end with hyphen");
      }
    }

    const mine = await ctx.db
      .query("tagSuggestions")
      .withIndex("by_project_nameKey", (q) => q.eq("projectId", project._id).eq("nameKey", nameKey))
      .collect();
    if (mine.some((s) => s.submitterId === viewer.userId && s.status !== "rejected")) return { ok: false, code: "duplicate" };
    const recent = await ctx.db
      .query("tagSuggestions")
      .withIndex("by_submitter_created", (q) => q.eq("submitterId", viewer.userId))
      .order("desc")
      .take(200);
    if (recent.filter((s) => s.status === "pending").length >= MAX_PENDING_PER_USER) return { ok: false, code: "too_many_pending" };

    await ctx.db.insert("tagSuggestions", {
      projectId: project._id,
      submitterId: viewer.userId,
      proposedName: tag ? tag.name : nameKey,
      nameKey,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      status: "pending",
      createdAt: Date.now(),
    });
    return { ok: true, status: "pending" };
  },
});

/** The viewer's own suggestions on one project (the default path's /api/projects/[id]/tag-submissions). */
export const mySuggestions = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const viewer = await getViewer(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    if (!viewer || !id) return [];
    const rows = await ctx.db
      .query("tagSuggestions")
      .withIndex("by_submitter_created", (q) => q.eq("submitterId", viewer.userId))
      .order("desc")
      .take(200);
    return rows
      .filter((s) => s.projectId === id)
      .map((s) => ({ id: s._id, name: s.proposedName, status: s.status, note: s.note ?? null, adminNotes: s.adminNotes ?? null, createdAt: s.createdAt }));
  },
});

// ---------------------------------------------------------------------------
// Moderation (users.role === "admin")

/** Pending suggestions grouped by nameKey, oldest first, with project and submitter names; no emails. */
export const listPending = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminViewer(ctx))) return null;
    const rows = await ctx.db
      .query("tagSuggestions")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .take(500);
    const groups = new Map<string, { nameKey: string; count: number; suggestions: unknown[] }>();
    for (const s of rows) {
      const project = await ctx.db.get(s.projectId);
      const submitter = s.submitterId
        ? await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", s.submitterId!)).first()
        : null;
      const group = groups.get(s.nameKey) ?? { nameKey: s.nameKey, count: 0, suggestions: [] };
      group.count++;
      group.suggestions.push({
        id: s._id,
        name: s.proposedName,
        note: s.note ?? null,
        createdAt: s.createdAt,
        project: project ? { id: project._id, slug: project.slug, title: project.title, tagCount: project.tagCount } : null,
        submitterUsername: submitter?.username ?? null,
      });
      groups.set(s.nameKey, group);
    }
    return [...groups.values()];
  },
});

const notesArg = v.optional(v.string());
const checkNotes = (notes: string | undefined): Refused | null =>
  notes !== undefined && notes.length > MAX_ADMIN_NOTES_LENGTH ? invalid(`Admin notes must be at most ${MAX_ADMIN_NOTES_LENGTH} characters`, "adminNotes") : null;

async function pendingSuggestion(ctx: QueryCtx, suggestionId: string): Promise<Doc<"tagSuggestions"> | null> {
  const id = ctx.db.normalizeId("tagSuggestions", suggestionId);
  return id ? await ctx.db.get(id) : null;
}

export const approve = mutation({
  args: { suggestionId: v.string(), scope: v.union(v.literal("project"), v.literal("system")), adminNotes: notesArg },
  handler: async (ctx, { suggestionId, scope, adminNotes }): Promise<ModerateResult> => {
    const admin = await adminViewer(ctx);
    const suggestion = admin ? await pendingSuggestion(ctx, suggestionId) : null;
    if (!admin || !suggestion) return { ok: false, code: "not_found" };
    if (suggestion.status !== "pending") return { ok: false, code: "not_pending" };
    const bad = checkNotes(adminNotes);
    if (bad) return bad;

    const now = Date.now();
    let tag = await tagByKey(ctx, suggestion.nameKey);
    if (tag?.status === "retired") return invalid(`The tag "${tag.name}" is retired`);

    const project = await ctx.db.get(suggestion.projectId);
    const live = project && project.status === "active" ? project : null;
    if (scope === "project" && live && !(tag && live.tagIds.includes(tag._id)) && live.tagIds.length >= MAX_PROJECT_TAGS) {
      return { ok: false, code: "limit" };
    }
    if (!tag) {
      const tagId = await ctx.db.insert("tags", { name: suggestion.proposedName, nameKey: suggestion.nameKey, status: "active", listedProjectCount: 0, createdAt: now });
      tag = (await ctx.db.get(tagId))!;
    }
    if (scope === "project" && live && !live.tagIds.includes(tag._id)) await attachTag(ctx, live, tag._id, now);
    await ctx.db.patch(suggestion._id, {
      status: "approved",
      resolvedTagId: tag._id,
      reviewerId: admin.userId,
      reviewedAt: now,
      adminNotes: adminNotes ?? (scope === "system" ? "Approved for system-wide use only" : "Approved for system and project"),
    });

    // The other pending suggestions of the same tag: attached where there is
    // room, rejected at the limit, as the default path does.
    const others = (await ctx.db.query("tagSuggestions").withIndex("by_status_created", (q) => q.eq("status", "pending")).take(1000))
      .filter((s) => s.nameKey === suggestion.nameKey && s._id !== suggestion._id)
      .slice(0, SETTLE_BATCH);
    for (const other of others) {
      const p = await ctx.db.get(other.projectId);
      const settled = { resolvedTagId: tag._id, reviewerId: admin.userId, reviewedAt: now };
      if (p && p.status === "active" && !p.tagIds.includes(tag._id) && p.tagIds.length >= MAX_PROJECT_TAGS) {
        await ctx.db.patch(other._id, { ...settled, status: "rejected", adminNotes: `Could not auto-approve - project already has the maximum of ${MAX_PROJECT_TAGS} tags` });
        continue;
      }
      if (p && p.status === "active" && !p.tagIds.includes(tag._id)) await attachTag(ctx, p, tag._id, now);
      await ctx.db.patch(other._id, { ...settled, status: "approved", adminNotes: "Automatically approved as tag was approved for another submission" });
    }
    return { ok: true };
  },
});

export const reject = mutation({
  args: { suggestionId: v.string(), adminNotes: notesArg },
  handler: async (ctx, { suggestionId, adminNotes }): Promise<ModerateResult> => {
    const admin = await adminViewer(ctx);
    const suggestion = admin ? await pendingSuggestion(ctx, suggestionId) : null;
    if (!admin || !suggestion) return { ok: false, code: "not_found" };
    if (suggestion.status !== "pending") return { ok: false, code: "not_pending" };
    const bad = checkNotes(adminNotes);
    if (bad) return bad;
    await ctx.db.patch(suggestion._id, {
      status: "rejected",
      reviewerId: admin.userId,
      reviewedAt: Date.now(),
      ...(adminNotes !== undefined ? { adminNotes } : {}),
    });
    return { ok: true };
  },
});
