// D09 S02b: the request rules of search v1 (S00.3 §3, §10), pure so the
// Convex query, the API route and the tests share them. No Convex, Next or
// database imports.
//
// The cursor is an envelope around the page position: it binds the query,
// scope, filters, sort, page size and index generation (a cursor from another
// query is refused), counts pages (at most MAX_PAGES), and carries short hashes
// of the previous page's IDs so a project that slid onto the next page because
// of a write in between isn't returned twice. It holds only public values;
// tampering can at worst ask for another page of the same public results.

import { SEARCH_PROJECTION_VERSION } from "./public-search-doc";

export const API_VERSION = 1;
export const MAX_QUERY_LENGTH = 200;
export const MAX_QUERY_TERMS = 8;
export const MAX_TAG_FILTERS = 10;
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 48;
export const MAX_PAGES = 20;
/** The most rows one Convex search (or one bounded scan) returns; 1,024 means "maybe more". */
export const SCAN_LIMIT = 1024;
/** Bumped when the vocabulary or ranking changes, so old cursors stop matching. */
export const RANKING_VERSION = 1;
export const GENERATION = `native-p${SEARCH_PROJECTION_VERSION}-r${RANKING_VERSION}`;

export const SEARCH_SORTS = ["relevance", "newest", "recently-edited", "popular", "alphabetical"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export interface SearchArgs {
  q: string;
  handle?: string;
  category?: string;
  tags?: string[];
  sort?: SearchSort;
  cursor?: string | null;
  pageSize?: number;
}

export type RequestIssue = { field: string; message: string };

export interface Envelope {
  v: 1;
  /** Hash of everything the cursor is bound to. */
  k: string;
  /** Zero-based index of the page this cursor asks for. */
  p: number;
  /** Convex's own pagination cursor (relevance path only). */
  c?: string;
  /** Short hashes of the previous page's entity IDs. */
  s: string[];
}

/** 32-bit FNV-1a, hex. Enough to tell IDs on one page apart; not a security hash. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function normalizeQuery(q: string): string {
  return q.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** The sort a request gets: relevance by default with a query, newest without one. */
export function effectiveSort(args: Pick<SearchArgs, "q" | "sort">): SearchSort {
  if (args.sort) return args.sort;
  return normalizeQuery(args.q) ? "relevance" : "newest";
}

/** Shape checks that need no data. Unknown categories, tags and handles are checked against data by the caller. */
export function checkRequest(args: SearchArgs): RequestIssue[] {
  const issues: RequestIssue[] = [];
  const q = normalizeQuery(args.q);
  if (q.length > MAX_QUERY_LENGTH) issues.push({ field: "q", message: `Search text must be at most ${MAX_QUERY_LENGTH} characters` });
  if (q.split(" ").filter(Boolean).length > MAX_QUERY_TERMS) issues.push({ field: "q", message: `Search text must be at most ${MAX_QUERY_TERMS} words` });
  if (args.sort !== undefined && !(SEARCH_SORTS as readonly string[]).includes(args.sort)) issues.push({ field: "sort", message: `Unknown sort "${args.sort}"` });
  if (args.sort === "relevance" && !q) issues.push({ field: "sort", message: "Relevance needs search text" });
  if (args.tags && args.tags.length > MAX_TAG_FILTERS) issues.push({ field: "tags", message: `At most ${MAX_TAG_FILTERS} tags` });
  if (args.pageSize !== undefined && (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > MAX_PAGE_SIZE)) {
    issues.push({ field: "pageSize", message: `Page size must be 1 to ${MAX_PAGE_SIZE}` });
  }
  if (args.handle !== undefined && (args.handle.length === 0 || args.handle.length > 100)) issues.push({ field: "handle", message: "Unknown creator" });
  return issues;
}

/** What a cursor is bound to. */
export function cursorKey(args: SearchArgs): string {
  const parts = [
    normalizeQuery(args.q).toLowerCase(),
    args.handle?.toLowerCase() ?? "",
    args.category ?? "",
    [...(args.tags ?? [])].map((t) => t.toLowerCase()).sort().join("\u0001"),
    effectiveSort(args),
    String(args.pageSize ?? DEFAULT_PAGE_SIZE),
    GENERATION,
  ];
  return shortHash(parts.join("\u0000"));
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export function encodeCursor(e: Envelope): string {
  return b64(JSON.stringify(e));
}

/** The envelope, or null when the cursor is malformed, from another query or generation, or past the page cap. */
export function decodeCursor(cursor: string, args: SearchArgs): Envelope | null {
  if (cursor.length > 4096) return null;
  try {
    const e = JSON.parse(unb64(cursor)) as Envelope;
    if (e.v !== 1 || e.k !== cursorKey(args)) return null;
    if (!Number.isInteger(e.p) || e.p < 1 || e.p >= MAX_PAGES) return null;
    if (!Array.isArray(e.s) || e.s.length > MAX_PAGE_SIZE || e.s.some((h) => typeof h !== "string" || !/^[0-9a-f]{8}$/.test(h))) return null;
    if (e.c !== undefined && (typeof e.c !== "string" || e.c.length > 2048)) return null;
    return e;
  } catch {
    return null;
  }
}

/** Drops rows whose ID hash was on the previous page. */
export function dedupeAgainst<T extends { id: string }>(rows: T[], previous: readonly string[]): T[] {
  if (!previous.length) return rows;
  const seen = new Set(previous);
  return rows.filter((r) => !seen.has(shortHash(r.id)));
}

/** The next cursor after serving `page` (0-based) with these IDs; null at the page cap or the end. */
export function nextCursor(args: SearchArgs, page: number, servedIds: string[], more: boolean, convexCursor?: string): string | null {
  if (!more || page + 1 >= MAX_PAGES) return null;
  return encodeCursor({ v: 1, k: cursorKey(args), p: page + 1, ...(convexCursor ? { c: convexCursor } : {}), s: servedIds.map(shortHash) });
}

/** Parses GET /api/search query parameters into SearchArgs (shape only; checkRequest validates). */
export function parseSearchParams(params: URLSearchParams): SearchArgs {
  const tags = [...params.getAll("tags").flatMap((t) => t.split(",")), ...params.getAll("tag")].map((t) => t.trim()).filter(Boolean);
  const pageSize = params.get("pageSize");
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    ...(params.get("handle") ? { handle: params.get("handle")! } : {}),
    ...(params.get("category") ? { category: params.get("category")! } : {}),
    ...(tags.length ? { tags } : {}),
    ...(sort ? { sort: sort as SearchSort } : {}),
    ...(params.get("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(pageSize !== null ? { pageSize: Number(pageSize) } : {}),
  };
}
