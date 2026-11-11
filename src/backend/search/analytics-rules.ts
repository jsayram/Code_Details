// D10 day one (S00.3 §6–§9, Jose's decisions 5 and 6): the analytics rules,
// pure so the Convex functions, the API routes and the tests share them.
//
// What is stored never names a person: no user ID, email, IP address or user
// agent. A search is tied to its clicks only through a random per-site visit
// token the browser makes and renews, and through a server-issued receipt that
// lists the projects shown and their positions. Visitors who send Global
// Privacy Control or Do Not Track get no visit token, no receipt and no
// client events; their searches still count as operational requests.

import { normalizeQuery } from "./search-rules";

export const METRIC_VERSION = "Code Details metric v1";
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const CLICK_WINDOW_MS = 30 * 60 * 1000;
export const FAVORITE_WINDOW_MS = 30 * 60 * 1000;
export const CLOCK_SKEW_MS = 10 * 60 * 1000;
export const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const DAILY_RETENTION_MONTHS = 25;
export const RARE_THRESHOLD = 3;
export const RARE_QUERY = "(rare)";
export const BROWSE_QUERY = "(browse)";
export const LOW_RESULTS_MAX = 2;
export const MAX_EVENT_BATCH = 20;
export const MAX_EVENT_BODY_BYTES = 16 * 1024;
/** One aggregation pass reads at most this many raw events of a day; more is reported as truncated. */
export const MAX_AGGREGATE_EVENTS = 8000;

export const DROP_REASONS = [
  "collection_off", "unauthorized", "batch_too_large", "invalid", "duplicate", "no_receipt", "expired",
  "visit_mismatch", "position_mismatch", "not_presented",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** A random token the browser makes: URL-safe, 16–64 characters. Anything else is refused. */
export function validVisitToken(token: string | null | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

/** Global Privacy Control or Do Not Track. */
export function optedOut(headers: Headers): boolean {
  return headers.get("sec-gpc")?.trim() === "1" || headers.get("dnt")?.trim() === "1";
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_WITH_QUERY = /\b(?:https?:\/\/|www\.)\S*[?#]\S*/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const LONG_DIGITS = /\d[\d\s-]{5,}\d/g;
const KEY_LIKE = /\b[A-Za-z0-9_+/=-]{24,}\b/g;

/**
 * The query as stored: normalised, lowercased, with emails, URLs, long digit
 * runs (phone or card numbers) and key-shaped strings replaced. A filter, not
 * a guarantee: anything it misses is still kept only 90 days.
 */
export function redactQuery(q: string): string {
  return normalizeQuery(q)
    .toLowerCase()
    .replace(EMAIL, "[email]")
    .replace(URL_WITH_QUERY, "[url]")
    .replace(URL, "[url]")
    .replace(LONG_DIGITS, "[number]")
    .replace(KEY_LIKE, (m) => (/\d/.test(m) && /[a-z]/i.test(m) ? "[key]" : m))
    .slice(0, 200);
}

/** UTC calendar day, YYYY-MM-DD. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The client's clock if it is within ±10 minutes of the server's, else the server's, flagged. */
export function clampClientAt(clientAt: number | undefined, now: number): { at: number; skewed: boolean } {
  if (clientAt === undefined || !Number.isFinite(clientAt)) return { at: now, skewed: false };
  return Math.abs(clientAt - now) <= CLOCK_SKEW_MS ? { at: clientAt, skewed: false } : { at: now, skewed: true };
}

/** The first day kept by the 25-month retention for daily totals, as YYYY-MM-DD. */
export function dailyRetentionStart(now: number): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - DAILY_RETENTION_MONTHS);
  return dayOf(d.getTime());
}

// ---------------------------------------------------------------------------
// Daily totals

export type StoredEvent = {
  type: "search_executed" | "browse_executed" | "results_presented" | "result_clicked" | "favorite_created";
  receiptId?: string;
  product?: boolean;
  query?: string;
  scope?: "global" | "creator";
  status?: "ok" | "error";
  zero?: boolean;
  low?: boolean;
  channel: string;
};

export type DailyRow = {
  query: string;
  scope: "global" | "creator";
  channel: string;
  /** Product searches (S00.3 §7): settled or submitted, not every keystroke. */
  searches: number;
  /** Every search request, product or not (operations). */
  requests: number;
  zeroResults: number;
  lowResults: number;
  errors: number;
  /** Product searches with a results_presented event. */
  presented: number;
  /** Presented product searches with at least one validated click. */
  clickedSearches: number;
  clicks: number;
  favorites: number;
  browses: number;
};

const emptyRow = (query: string, scope: DailyRow["scope"], channel: string): DailyRow => ({
  query, scope, channel, searches: 0, requests: 0, zeroResults: 0, lowResults: 0, errors: 0, presented: 0, clickedSearches: 0, clicks: 0, favorites: 0, browses: 0,
});

/**
 * One day's totals per (query, scope, channel) from that day's stored events.
 * Clicks, presentations and favorites count toward the search their receipt
 * names. Queries with fewer than RARE_THRESHOLD product searches are merged
 * into one "(rare)" row per scope and channel; browsing is its own row.
 */
export function aggregateDay(events: readonly StoredEvent[]): DailyRow[] {
  const searchOf = new Map<string, { key: string; product: boolean }>();
  const rows = new Map<string, DailyRow>();
  const row = (query: string, scope: DailyRow["scope"], channel: string) => {
    const key = `${query}\u0000${scope}\u0000${channel}`;
    if (!rows.has(key)) rows.set(key, emptyRow(query, scope, channel));
    return { key, r: rows.get(key)! };
  };
  for (const e of events) {
    if (e.type === "browse_executed") row(BROWSE_QUERY, e.scope ?? "global", e.channel).r.browses++;
    if (e.type !== "search_executed") continue;
    const { key, r } = row(e.query ?? "", e.scope ?? "global", e.channel);
    r.requests++;
    if (e.receiptId) searchOf.set(e.receiptId, { key, product: !!e.product });
    if (!e.product) continue;
    r.searches++;
    if (e.status === "error") r.errors++;
    else if (e.zero) r.zeroResults++;
    else if (e.low) r.lowResults++;
  }
  const presented = new Set<string>();
  const clicked = new Set<string>();
  for (const e of events) {
    const s = e.receiptId ? searchOf.get(e.receiptId) : undefined;
    if (!s || !s.product) continue;
    const r = rows.get(s.key)!;
    if (e.type === "results_presented" && !presented.has(e.receiptId!)) {
      presented.add(e.receiptId!);
      r.presented++;
    }
    if (e.type === "result_clicked") r.clicks++;
    if (e.type === "favorite_created") r.favorites++;
  }
  for (const e of events) {
    if (e.type !== "result_clicked" || !e.receiptId || clicked.has(e.receiptId) || !presented.has(e.receiptId)) continue;
    const s = searchOf.get(e.receiptId);
    if (!s || !s.product) continue;
    clicked.add(e.receiptId);
    rows.get(s.key)!.clickedSearches++;
  }

  // Rare queries: merged, so odd one-off searches aren't kept as text in the totals.
  const out = new Map<string, DailyRow>();
  for (const r of rows.values()) {
    const rare = r.query !== BROWSE_QUERY && r.searches < RARE_THRESHOLD;
    const query = rare ? RARE_QUERY : r.query;
    const key = `${query}\u0000${r.scope}\u0000${r.channel}`;
    const t = out.get(key) ?? emptyRow(query, r.scope, r.channel);
    for (const k of ["searches", "requests", "zeroResults", "lowResults", "errors", "presented", "clickedSearches", "clicks", "favorites", "browses"] as const) t[k] += r[k];
    out.set(key, t);
  }
  return [...out.values()].sort((a, b) => b.searches - a.searches || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
}
