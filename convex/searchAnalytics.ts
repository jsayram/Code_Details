// D10 day one: search analytics on Convex (S00.3 §6–§9; Jose's decisions 5
// and 6). Nothing here runs unless the deployment set
// CODEDETAILS_SEARCH_ANALYTICS_ALLOWED=1, which only tests/convex/push.mjs's
// test target does; on any other deployment every write is a counted no-op,
// so real collection stays off until Jose turns it on.
//
// - recordSearch: the Next.js server records each search after answering it,
//   with its internal secret (CODEDETAILS_INTERNAL_AUTH_SECRET); a receipt is
//   kept only when the visitor sent a visit token (none under GPC/DNT).
// - recordClientEvents: results shown and clicks, each checked against its
//   receipt (same visit, unexpired, that project at that position).
// - attributeFavorite: called by favorites:add when the client passes a live
//   receipt; counts only after a validated click on that project.
// - aggregateDay / applyRetention: daily totals and retention, from cron.
// - report: the first site report, admins only.
// Failures here never reach search: the routes call these after responding
// and swallow errors.

import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getViewer } from "./viewer";
import { isInternalAuthCall } from "./authRules";
import {
  CLICK_WINDOW_MS,
  FAVORITE_WINDOW_MS,
  LOW_RESULTS_MAX,
  MAX_AGGREGATE_EVENTS,
  MAX_EVENT_BATCH,
  METRIC_VERSION,
  RAW_RETENTION_MS,
  RECEIPT_TTL_MS,
  aggregateDay as aggregate,
  clampClientAt,
  dailyRetentionStart,
  dayOf,
  redactQuery,
  validVisitToken,
  type DropReason,
} from "../src/backend/search/analytics-rules";

export const collectionAllowed = () => process.env.CODEDETAILS_SEARCH_ANALYTICS_ALLOWED === "1";
const CHANNEL = "web";

async function drop(ctx: MutationCtx, reason: DropReason, now: number, n = 1) {
  const day = dayOf(now);
  const row = await ctx.db.query("searchDrops").withIndex("by_day_reason", (q) => q.eq("day", day).eq("reason", reason)).first();
  if (row) await ctx.db.patch(row._id, { count: row.count + n });
  else await ctx.db.insert("searchDrops", { day, reason, count: n });
}

async function seen(ctx: MutationCtx, eventId: string) {
  return !!(await ctx.db.query("searchEvents").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).first());
}

export const recordSearch = mutation({
  args: {
    serverSecret: v.string(),
    receiptId: v.string(),
    visit: v.optional(v.string()),
    interactionId: v.optional(v.string()),
    browse: v.boolean(),
    product: v.boolean(),
    query: v.string(),
    scope: v.union(v.literal("global"), v.literal("creator")),
    sort: v.string(),
    filterCount: v.number(),
    page: v.number(),
    status: v.union(v.literal("ok"), v.literal("error")),
    hits: v.array(v.object({ entityId: v.string(), position: v.number() })),
    hasMore: v.boolean(),
    latencyMs: v.number(),
  },
  handler: async (ctx, a): Promise<{ stored: boolean; receipt: boolean }> => {
    const now = Date.now();
    if (!collectionAllowed()) return { stored: false, receipt: false };
    if (!isInternalAuthCall(a.serverSecret, process.env.CODEDETAILS_INTERNAL_AUTH_SECRET)) {
      await drop(ctx, "unauthorized", now);
      return { stored: false, receipt: false };
    }
    const eventId = `${a.receiptId}:executed`;
    if (await seen(ctx, eventId)) {
      await drop(ctx, "duplicate", now);
      return { stored: false, receipt: false };
    }
    const visit = validVisitToken(a.visit) ? a.visit : undefined;
    const query = redactQuery(a.query);
    const hitCount = a.hits.length;
    await ctx.db.insert("searchEvents", {
      eventId,
      type: a.browse ? "browse_executed" : "search_executed",
      channel: CHANNEL,
      day: dayOf(now),
      acceptedAt: now,
      receiptId: a.receiptId,
      ...(visit ? { visit } : {}),
      ...(a.interactionId && a.interactionId.length <= 64 ? { interactionId: a.interactionId } : {}),
      product: !a.browse && a.product,
      ...(a.browse ? {} : { query }),
      scope: a.scope,
      sort: a.sort,
      filterCount: a.filterCount,
      page: a.page,
      status: a.status,
      hitCount,
      zero: a.status === "ok" && a.page === 0 && hitCount === 0,
      low: a.status === "ok" && a.page === 0 && !a.hasMore && hitCount > 0 && hitCount <= LOW_RESULTS_MAX,
      latencyMs: Math.max(0, Math.round(a.latencyMs)),
    });
    // Receipts only for real searches with a visit: what clicks are checked against.
    const receipt = !a.browse && a.status === "ok" && !!visit && hitCount > 0;
    if (receipt) {
      await ctx.db.insert("searchReceipts", {
        receiptId: a.receiptId,
        visit: visit!,
        query,
        scope: a.scope,
        hits: a.hits.slice(0, 48),
        createdAt: now,
        expiresAt: now + RECEIPT_TTL_MS,
      });
    }
    return { stored: true, receipt };
  },
});

const clientEvent = v.union(
  v.object({ type: v.literal("results_presented"), eventId: v.string(), receiptId: v.string(), positions: v.array(v.number()), clientAt: v.optional(v.number()) }),
  v.object({ type: v.literal("result_clicked"), eventId: v.string(), receiptId: v.string(), entityId: v.string(), position: v.number(), clientAt: v.optional(v.number()) }),
);

async function liveReceipt(ctx: MutationCtx, receiptId: string, visit: string, now: number): Promise<Doc<"searchReceipts"> | DropReason> {
  const r = await ctx.db.query("searchReceipts").withIndex("by_receiptId", (q) => q.eq("receiptId", receiptId)).first();
  if (!r) return "no_receipt";
  if (r.expiresAt < now) return "expired";
  if (r.visit !== visit) return "visit_mismatch";
  return r;
}

export const recordClientEvents = mutation({
  args: { visit: v.string(), events: v.array(clientEvent) },
  handler: async (ctx, { visit, events }): Promise<{ accepted: number; dropped: number }> => {
    const now = Date.now();
    if (!collectionAllowed()) return { accepted: 0, dropped: events.length };
    if (!validVisitToken(visit)) {
      await drop(ctx, "invalid", now, events.length);
      return { accepted: 0, dropped: events.length };
    }
    if (events.length > MAX_EVENT_BATCH) {
      await drop(ctx, "batch_too_large", now, events.length);
      return { accepted: 0, dropped: events.length };
    }
    let accepted = 0;
    for (const e of events) {
      if (!/^[A-Za-z0-9:_-]{8,80}$/.test(e.eventId)) {
        await drop(ctx, "invalid", now);
        continue;
      }
      if (await seen(ctx, e.eventId)) {
        await drop(ctx, "duplicate", now);
        continue;
      }
      const receipt = await liveReceipt(ctx, e.receiptId, visit, now);
      if (typeof receipt === "string") {
        await drop(ctx, receipt, now);
        continue;
      }
      // A click must arrive within the attribution window of its search.
      if (e.type === "result_clicked" && now - receipt.createdAt > CLICK_WINDOW_MS) {
        await drop(ctx, "expired", now);
        continue;
      }
      const shown = new Map(receipt.hits.map((h) => [h.position, h.entityId]));
      let fields: { positions: number[] } | { entityId: string; position: number };
      if (e.type === "results_presented") {
        const positions = [...new Set(e.positions)];
        if (positions.length === 0 || positions.length > 48 || positions.some((p) => !shown.has(p))) {
          await drop(ctx, "position_mismatch", now);
          continue;
        }
        fields = { positions };
      } else {
        if (shown.get(e.position) !== e.entityId) {
          await drop(ctx, "position_mismatch", now);
          continue;
        }
        fields = { entityId: e.entityId, position: e.position };
      }
      const { at, skewed } = clampClientAt(e.clientAt, now);
      await ctx.db.insert("searchEvents", {
        eventId: e.eventId,
        type: e.type,
        channel: CHANNEL,
        day: dayOf(now),
        acceptedAt: now,
        clientAt: at,
        ...(skewed ? { skewed } : {}),
        receiptId: e.receiptId,
        visit,
        scope: receipt.scope,
        ...fields,
      });
      accepted++;
    }
    return { accepted, dropped: events.length - accepted };
  },
});

/**
 * favorites:add calls this after a favorite is really created, when the
 * client passed the search it came from. It counts only if that visit
 * clicked this project from that search within the window. Never throws.
 */
export async function attributeFavorite(ctx: MutationCtx, search: { receiptId: string; visit: string }, entityId: string): Promise<boolean> {
  try {
    const now = Date.now();
    if (!collectionAllowed() || !validVisitToken(search.visit)) return false;
    const clicks = await ctx.db
      .query("searchEvents")
      .withIndex("by_receipt_type", (q) => q.eq("receiptId", search.receiptId).eq("type", "result_clicked"))
      .take(100);
    const click = clicks.find((c) => c.entityId === entityId && c.visit === search.visit && now - c.acceptedAt <= FAVORITE_WINDOW_MS);
    if (!click) return false;
    const eventId = `${search.receiptId}:favorite:${entityId}`;
    if (await seen(ctx, eventId)) return false;
    await ctx.db.insert("searchEvents", {
      eventId,
      type: "favorite_created",
      channel: CHANNEL,
      day: dayOf(now),
      acceptedAt: now,
      receiptId: search.receiptId,
      visit: search.visit,
      scope: click.scope,
      entityId,
    });
    return true;
  } catch {
    return false;
  }
}

/** Rebuilds one day's totals from that day's events (yesterday by default). */
export const aggregateDay = internalMutation({
  args: { day: v.optional(v.string()) },
  handler: async (ctx, { day }): Promise<{ day: string; events: number; rows: number; truncated: boolean } | null> => {
    if (!collectionAllowed()) return null;
    const target = day ?? dayOf(Date.now() - 24 * 60 * 60 * 1000);
    const events = await ctx.db.query("searchEvents").withIndex("by_day", (q) => q.eq("day", target)).take(MAX_AGGREGATE_EVENTS + 1);
    const truncated = events.length > MAX_AGGREGATE_EVENTS;
    const rows = aggregate(events.slice(0, MAX_AGGREGATE_EVENTS));
    for (const old of await ctx.db.query("searchDaily").withIndex("by_day", (q) => q.eq("day", target)).collect()) await ctx.db.delete(old._id);
    const now = Date.now();
    for (const r of rows) await ctx.db.insert("searchDaily", { day: target, ...r, updatedAt: now });
    return { day: target, events: Math.min(events.length, MAX_AGGREGATE_EVENTS), rows: rows.length, truncated };
  },
});

/** Retention: receipts past 24 hours, raw events and drop counts past 90 days, daily totals past 25 months. */
export const applyRetention = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ receipts: number; events: number; daily: number; drops: number } | null> => {
    if (!collectionAllowed()) return null;
    const now = Date.now();
    const BATCH = 500;
    const receipts = await ctx.db.query("searchReceipts").withIndex("by_expires", (q) => q.lt("expiresAt", now)).take(BATCH);
    for (const r of receipts) await ctx.db.delete(r._id);
    const events = await ctx.db.query("searchEvents").withIndex("by_accepted", (q) => q.lt("acceptedAt", now - RAW_RETENTION_MS)).take(BATCH);
    for (const e of events) await ctx.db.delete(e._id);
    const oldest = dailyRetentionStart(now);
    const daily = await ctx.db.query("searchDaily").withIndex("by_day", (q) => q.lt("day", oldest)).take(BATCH);
    for (const d of daily) await ctx.db.delete(d._id);
    const dropDay = dayOf(now - RAW_RETENTION_MS);
    const drops = await ctx.db.query("searchDrops").withIndex("by_day_reason", (q) => q.lt("day", dropDay)).take(BATCH);
    for (const d of drops) await ctx.db.delete(d._id);
    return { receipts: receipts.length, events: events.length, daily: daily.length, drops: drops.length };
  },
});

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

/** The first site report (decision 6), admins only: from the daily totals, plus operations from raw events. */
export const report = query({
  args: { fromDay: v.string(), toDay: v.string() },
  handler: async (ctx, { fromDay, toDay }) => {
    const viewer = await getViewer(ctx);
    if (!viewer || viewer.role !== "admin") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || fromDay > toDay) return null;
    const rows = await ctx.db.query("searchDaily").withIndex("by_day", (q) => q.gte("day", fromDay).lte("day", toDay)).take(5000);
    const sum = (k: "searches" | "requests" | "zeroResults" | "lowResults" | "errors" | "presented" | "clickedSearches" | "clicks" | "favorites" | "browses") =>
      rows.reduce((n, r) => n + r[k], 0);
    const byQuery = new Map<string, { searches: number; zeroResults: number; presented: number; clickedSearches: number }>();
    for (const r of rows) {
      if (r.query === "(browse)") continue;
      const q = byQuery.get(r.query) ?? { searches: 0, zeroResults: 0, presented: 0, clickedSearches: 0 };
      q.searches += r.searches;
      q.zeroResults += r.zeroResults;
      q.presented += r.presented;
      q.clickedSearches += r.clickedSearches;
      byQuery.set(r.query, q);
    }
    const list = [...byQuery.entries()].map(([q, s]) => ({ query: q, ...s }));
    const searches = sum("searches");
    const ok = searches - sum("errors");
    const presented = sum("presented");
    const raw = await ctx.db
      .query("searchEvents")
      .withIndex("by_day", (q) => q.gte("day", fromDay).lte("day", toDay))
      .take(5000);
    const latencies = raw.filter((e) => e.type === "search_executed" && e.latencyMs !== undefined).map((e) => e.latencyMs!);
    const drops = await ctx.db.query("searchDrops").withIndex("by_day_reason", (q) => q.gte("day", fromDay).lte("day", toDay)).take(1000);
    const dropped: Record<string, number> = {};
    for (const d of drops) dropped[d.reason] = (dropped[d.reason] ?? 0) + d.count;
    return {
      metricVersion: METRIC_VERSION,
      window: { fromDay, toDay },
      totals: {
        searches,
        requests: sum("requests"),
        browses: sum("browses"),
        zeroResultRate: ok ? sum("zeroResults") / ok : null,
        errorRate: searches ? sum("errors") / searches : null,
        ctr: presented ? sum("clickedSearches") / presented : null,
        favoriteRate: presented ? sum("favorites") / presented : null,
        coverage: searches ? presented / searches : null,
      },
      topQueries: list.sort((a, b) => b.searches - a.searches || (a.query < b.query ? -1 : 1)).slice(0, 20),
      zeroResultQueries: list.filter((q) => q.zeroResults > 0).sort((a, b) => b.zeroResults - a.zeroResults || (a.query < b.query ? -1 : 1)).slice(0, 20),
      operations: { latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95) }, sampled: raw.length >= 5000, dropped },
    };
  },
});
