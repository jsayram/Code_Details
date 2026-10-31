// D09 S02b: Code Details Search v1 over the search_public index (S00.3 §3–4,
// S01 approach A1). Public queries with no identity argument: every caller,
// signed in or not, gets the same listed projects, built through the S00.2
// projection and asserted before they leave. A creator scope is a public
// handle resolved here, never a user ID from the caller.
//
// Two paths:
// - relevance with no tag filter: native search pagination, page by page;
// - anything else (another sort, a tag filter, or no query): at most 1,024
//   candidates (the native limit), filtered and sorted here. Totals, facets and
//   sorts are exact below 1,024 and reported as "gte" at 1,024.
// Unknown categories, tags and handles are refused, never silently dropped
// (P08 R32).

import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { usernameKey } from "../src/backend/profiles/public-profile";
import { isKnownCategory, tagNameKey } from "../src/backend/projects/project-update-rules";
import { SEARCH_HIT_KEYS, SEARCH_PROJECTION_VERSION, assertPublicSearchDoc, toPublicSearchDoc, type PublicSearchDoc } from "../src/backend/search/public-search-doc";
import {
  API_VERSION,
  DEFAULT_PAGE_SIZE,
  GENERATION,
  RANKING_VERSION,
  SCAN_LIMIT,
  checkRequest,
  decodeCursor,
  dedupeAgainst,
  effectiveSort,
  nextCursor,
  normalizeQuery,
  type RequestIssue,
  type SearchArgs,
  type SearchSort,
} from "../src/backend/search/search-rules";
import { rewriteQuery } from "../src/backend/search/vocabulary-layer";

export type SearchHit = Omit<PublicSearchDoc, "searchText" | "ranking">;
export type SearchRefusal = { ok: false; code: "invalid_request" | "unknown_filter" | "invalid_cursor"; issues: RequestIssue[] };
export type SearchResult =
  | {
      ok: true;
      apiVersion: number;
      hits: SearchHit[];
      total: { value: number; relation: "eq" | "gte" } | null;
      nextCursor: string | null;
      sort: SearchSort;
      applied: { normalizedQuery: string; correctedQuery?: string; expandedTerms?: string[] };
      generation: { index: string; ranking: number; projection: number };
    }
  | SearchRefusal;
export type FacetsResult =
  | { ok: true; category: Record<string, number>; tags: { name: string; count: number }[]; facetCounts: "exact" | "capped"; total: { value: number; relation: "eq" | "gte" } }
  | SearchRefusal;

const filterArgs = {
  q: v.string(),
  handle: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
};

const isPublic = (p: Doc<"projects">) => p.listed && p.status === "active" && p.visibility === "public";

type Resolved = { ownerId?: Id<"users">; category?: string; tagIds: Id<"tags">[] };

/** Checks the request, then resolves category, tags and handle against data. */
async function resolve(ctx: QueryCtx, args: SearchArgs): Promise<Resolved | SearchRefusal> {
  const shape = checkRequest(args);
  if (shape.length) return { ok: false, code: "invalid_request", issues: shape };
  const unknown: RequestIssue[] = [];
  const out: Resolved = { tagIds: [] };
  if (args.category !== undefined) {
    if (isKnownCategory(args.category)) out.category = args.category;
    else unknown.push({ field: "category", message: `Unknown category "${args.category}"` });
  }
  for (const name of args.tags ?? []) {
    const key = tagNameKey(name);
    let tag = key ? await ctx.db.query("tags").withIndex("by_nameKey", (q) => q.eq("nameKey", key)).first() : null;
    if (!tag && key) {
      const alias = await ctx.db.query("tagAliases").withIndex("by_aliasKey", (q) => q.eq("aliasKey", key)).first();
      tag = alias ? await ctx.db.get(alias.tagId) : null;
    }
    if (tag && tag.status === "active") {
      if (!out.tagIds.includes(tag._id)) out.tagIds.push(tag._id);
    } else unknown.push({ field: "tags", message: `Unknown tag "${name}"` });
  }
  if (args.handle !== undefined) {
    const key = usernameKey(args.handle);
    const profile = key ? await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", key)).first() : null;
    const user = profile ? await ctx.db.get(profile.userId) : null;
    if (user && user.status === "active") out.ownerId = user._id;
    else unknown.push({ field: "handle", message: `Unknown creator "${args.handle}"` });
  }
  return unknown.length ? { ok: false, code: "unknown_filter", issues: unknown } : out;
}

function searchIndex(ctx: QueryCtx, text: string, r: Resolved) {
  return ctx.db.query("projects").withSearchIndex("search_public", (s) => {
    let b = s.search("searchText", text).eq("listed", true);
    if (r.category) b = b.eq("category", r.category);
    if (r.ownerId) b = b.eq("ownerId", r.ownerId);
    return b;
  });
}

/** Browsing without a query: one bounded scan of an ordinary index, newest first. */
async function browseCandidates(ctx: QueryCtx, r: Resolved): Promise<Doc<"projects">[]> {
  if (r.ownerId) {
    return ctx.db.query("projects").withIndex("by_owner_listed_created", (q) => q.eq("ownerId", r.ownerId!).eq("listed", true)).order("desc").take(SCAN_LIMIT);
  }
  if (r.category) {
    return ctx.db.query("projects").withIndex("by_listed_category_created", (q) => q.eq("listed", true).eq("category", r.category!)).order("desc").take(SCAN_LIMIT);
  }
  return ctx.db.query("projects").withIndex("by_listed_created", (q) => q.eq("listed", true)).order("desc").take(SCAN_LIMIT);
}

/** Every candidate the request can see (≤ 1,024), public and matching every filter, in relevance or newest order. */
async function candidates(ctx: QueryCtx, text: string, r: Resolved): Promise<{ rows: Doc<"projects">[]; capped: boolean }> {
  const raw = text ? await searchIndex(ctx, text, r).take(SCAN_LIMIT) : await browseCandidates(ctx, r);
  const rows = raw.filter(
    (p) => isPublic(p) && (!r.category || p.category === r.category) && (!r.ownerId || p.ownerId === r.ownerId) && r.tagIds.every((t) => p.tagIds.includes(t)),
  );
  return { rows, capped: raw.length >= SCAN_LIMIT };
}

const titleKey = (p: Doc<"projects">) => p.titleSortKey;
const newest = (a: Doc<"projects">, b: Doc<"projects">) => b.createdAt - a.createdAt || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
const COMPARE: Record<Exclude<SearchSort, "relevance">, (a: Doc<"projects">, b: Doc<"projects">) => number> = {
  newest,
  "recently-edited": (a, b) => b.updatedAt - a.updatedAt || newest(a, b),
  // Popularity ranks by favorites from other people (P06 #5), never the public counter.
  popular: (a, b) => b.rankingFavoriteCount - a.rankingFavoriteCount || newest(a, b),
  alphabetical: (a, b) => (titleKey(a) < titleKey(b) ? -1 : titleKey(a) > titleKey(b) ? 1 : 0) || newest(a, b),
};

/** The hit for a project: the S00.2 document, asserted, without searchText or ranking. */
async function toHits(ctx: QueryCtx, rows: Doc<"projects">[]): Promise<SearchHit[]> {
  const owners = new Map<Id<"users">, { username: string; fullName: string | null } | null>();
  const hits: SearchHit[] = [];
  for (const p of rows) {
    if (!owners.has(p.ownerId)) {
      const user = await ctx.db.get(p.ownerId);
      const profile = user?.status === "active" ? await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", p.ownerId)).first() : null;
      owners.set(p.ownerId, profile ? { username: profile.username, fullName: profile.fullName ?? null } : null);
    }
    const tags = [];
    for (const id of p.tagIds) {
      const t = await ctx.db.get(id);
      if (t) tags.push({ id: t._id, name: t.name, status: t.status });
    }
    const doc = toPublicSearchDoc({ ...p, id: p._id }, owners.get(p.ownerId)!, tags);
    if (!doc) continue;
    assertPublicSearchDoc(doc);
    hits.push(Object.fromEntries(SEARCH_HIT_KEYS.map((k) => [k, doc[k]])) as SearchHit);
  }
  return hits;
}

export const projects = query({
  args: {
    ...filterArgs,
    sort: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, raw): Promise<SearchResult> => {
    const args = raw as SearchArgs;
    const r = await resolve(ctx, args);
    if ("ok" in r) return r;
    const sort = effectiveSort(args);
    const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
    const envelope = args.cursor ? decodeCursor(args.cursor, args) : null;
    if (args.cursor && !envelope) return { ok: false, code: "invalid_cursor", issues: [{ field: "cursor", message: "This cursor belongs to another search or has expired" }] };
    const page = envelope?.p ?? 0;
    const previous = envelope?.s ?? [];

    const q = normalizeQuery(args.q);
    const rw = q ? rewriteQuery(q, new Set()) : null;
    const applied = {
      normalizedQuery: q,
      ...(rw?.corrected.length ? { correctedQuery: rw.corrected.reduce((s, c) => s.replace(c.from, c.to), q) } : {}),
      ...(rw?.expanded.length ? { expandedTerms: rw.expanded } : {}),
    };
    const generation = { index: GENERATION, ranking: RANKING_VERSION, projection: SEARCH_PROJECTION_VERSION };

    let rows: Doc<"projects">[];
    let next: string | null;
    let total: { value: number; relation: "eq" | "gte" } | null = null;
    if (sort === "relevance" && r.tagIds.length === 0 && rw) {
      const res = await searchIndex(ctx, rw.q, r).paginate({ cursor: envelope?.c ?? null, numItems: pageSize });
      rows = dedupeAgainst(res.page.filter(isPublic).map((p) => Object.assign(p, { id: p._id as string })), previous);
      next = nextCursor(args, page, rows.map((p) => p._id), !res.isDone, res.continueCursor);
    } else {
      const { rows: all, capped } = await candidates(ctx, rw?.q ?? "", r);
      const sorted = sort === "relevance" ? all : [...all].sort(COMPARE[sort]);
      total = { value: sorted.length, relation: capped ? "gte" : "eq" };
      const slice = sorted.slice(page * pageSize, (page + 1) * pageSize).map((p) => Object.assign(p, { id: p._id as string }));
      rows = dedupeAgainst(slice, previous);
      next = nextCursor(args, page, rows.map((p) => p._id), (page + 1) * pageSize < sorted.length);
    }
    return { ok: true, apiVersion: API_VERSION, hits: await toHits(ctx, rows), total, nextCursor: next, sort, applied, generation };
  },
});

/** Category and tag counts for a search, computed on submit (S00.3 §4): exact below 1,024 candidates. */
export const facets = query({
  args: filterArgs,
  handler: async (ctx, raw): Promise<FacetsResult> => {
    const args = raw as SearchArgs;
    const r = await resolve(ctx, args);
    if ("ok" in r) return r;
    const q = normalizeQuery(args.q);
    const { rows, capped } = await candidates(ctx, q ? rewriteQuery(q, new Set()).q : "", r);
    const category: Record<string, number> = {};
    const tagCounts = new Map<Id<"tags">, number>();
    for (const p of rows) {
      category[p.category] = (category[p.category] ?? 0) + 1;
      for (const t of p.tagIds) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const tags: { name: string; count: number }[] = [];
    for (const [id, count] of tagCounts) {
      const t = await ctx.db.get(id);
      if (t && t.status === "active") tags.push({ name: t.name, count });
    }
    tags.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return {
      ok: true,
      category,
      tags: tags.slice(0, 30),
      facetCounts: capped ? "capped" : "exact",
      total: { value: rows.length, relation: capped ? "gte" : "eq" },
    };
  },
});
