// D09 S01: benchmark functions for the throwaway backend (see schema.ts).
// Public because the backend only ever holds synthetic documents and binds to
// 127.0.0.1; none of this is deployed with the app.

import { mutationGeneric as mutation, paginationOptsValidator, queryGeneric as query } from "convex/server";
import { v } from "convex/values";

const indexArg = v.union(v.literal("raw"), v.literal("ext"));
const docArg = v.object({
  entityId: v.string(),
  corpus: v.string(),
  title: v.string(),
  category: v.string(),
  owner: v.string(),
  tagNames: v.array(v.string()),
  searchText: v.string(),
  searchTextExt: v.string(),
  eligible: v.boolean(),
  favorites: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

type Filters = { category?: string; owner?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function searchQuery(ctx: any, index: "raw" | "ext", q: string, f: Filters) {
  const name = index === "raw" ? "search_raw" : "search_ext";
  const field = index === "raw" ? "searchText" : "searchTextExt";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.db.query("docs").withSearchIndex(name, (s: any) => {
    let b = s.search(field, q).eq("eligible", true);
    if (f.category) b = b.eq("category", f.category);
    if (f.owner) b = b.eq("owner", f.owner);
    return b;
  });
}

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("docs").take(2000);
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

export const load = mutation({
  args: { docs: v.array(docArg) },
  handler: async (ctx, { docs }) => {
    for (const d of docs) await ctx.db.insert("docs", d);
    return docs.length;
  },
});

/** One relevance-ordered page; tags (AND) are applied after retrieval, as Convex can't filter arrays in a search index. */
export const search = query({
  args: {
    index: indexArg,
    q: v.string(),
    category: v.optional(v.string()),
    owner: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    limit: v.number(),
    // Unused: a fresh value per call defeats Convex's query cache when timing.
    nonce: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const scan = a.tags?.length ? 1024 : a.limit;
    const rows = await searchQuery(ctx, a.index, a.q, a).take(scan);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kept = a.tags?.length ? rows.filter((r: any) => a.tags!.every((t) => r.tagNames.includes(t))) : rows;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ids: kept.slice(0, a.limit).map((r: any) => r.entityId), scanned: rows.length };
  },
});

/** Everything a search can reach (≤ 1024), for facet counts and non-relevance sorts. */
export const searchAll = query({
  args: { index: indexArg, q: v.string(), category: v.optional(v.string()), owner: v.optional(v.string()), nonce: v.optional(v.number()) },
  handler: async (ctx, a) => {
    // take(1025) throws "Search query scanned too many documents": 1024 is
    // the most one search can return, so 1024 rows means "maybe more".
    const kept = await searchQuery(ctx, a.index, a.q, a).take(1024);
    const truncated = kept.length === 1024;
    const category: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of kept as any[]) category[r.category] = (category[r.category] ?? 0) + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newest = [...(kept as any[])].sort((x, y) => y.createdAt - x.createdAt || (x.entityId < y.entityId ? -1 : 1)).slice(0, 10).map((r) => r.entityId);
    return { count: kept.length, truncated, category, newest };
  },
});

export const searchPage = query({
  args: { index: indexArg, q: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    const page = await searchQuery(ctx, a.index, a.q, {}).paginate(a.paginationOpts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ids: page.page.map((r: any) => r.entityId), continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Sorted browsing without a query, on ordinary indexes: newest first with a stable cursor. */
export const browse = query({
  args: { category: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    // Generic ctx (no codegen for the bench), so index ranges are untyped here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = ctx.db.query("docs") as any;
    const q = a.category
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? docs.withIndex("by_eligible_category_created", (i: any) => i.eq("eligible", true).eq("category", a.category!))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : docs.withIndex("by_eligible_created", (i: any) => i.eq("eligible", true));
    const page = await q.order("desc").paginate(a.paginationOpts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ids: page.page.map((r: any) => r.entityId), continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const patch = mutation({
  args: {
    entityId: v.string(),
    searchText: v.optional(v.string()),
    searchTextExt: v.optional(v.string()),
    eligible: v.optional(v.boolean()),
  },
  handler: async (ctx, { entityId, ...change }) => {
    const row = await ctx.db.query("docs").withIndex("by_entity", (i) => i.eq("entityId", entityId)).first();
    if (!row) return false;
    const set = Object.fromEntries(Object.entries(change).filter(([, val]) => val !== undefined));
    await ctx.db.patch(row._id, { ...set, updatedAt: Date.now() });
    return true;
  },
});

export const remove = mutation({
  args: { entityId: v.string() },
  handler: async (ctx, { entityId }) => {
    const row = await ctx.db.query("docs").withIndex("by_entity", (i) => i.eq("entityId", entityId)).first();
    if (row) await ctx.db.delete(row._id);
    return !!row;
  },
});
