// D10 day one on the task-owned test backend (synthetic data only), through
// the real routes in-process: searches recorded after the response, receipts
// only with a visit token and never under GPC/DNT, client events checked
// against receipts, favorites attributed only after a validated click, daily
// totals compared with numbers worked out by hand for the scenario below,
// retention, the admin-only report, and nothing that names a person stored.
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { makeFunctionReference } from "convex/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { CONVEX_URL, adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, warmPersonas } from "../fixtures/convex-auth";
import { RUNTIME_DIR } from "../support/test-db";
import { searchLimiter } from "@/backend/search/search-client";
import { RARE_QUERY, dayOf } from "@/backend/search/analytics-rules";

type Row = Record<string, unknown>;
type State = { events: Row[]; receipts: Row[]; daily: Row[]; drops: { day: string; reason: string; count: number }[] };
const state = () => adminClient().query(makeFunctionReference<"query", Record<string, never>, State>("fixtures:searchAnalyticsState"), {});
const insertRows = makeFunctionReference<"mutation", Record<string, Row[]>, null>("fixtures:insertSearchAnalyticsRows");
const aggregate = makeFunctionReference<"mutation", { day?: string }, { day: string; events: number; rows: number; truncated: boolean } | null>("searchAnalytics:aggregateDay");
const purge = makeFunctionReference<"mutation", Record<string, never>, { receipts: number; events: number; daily: number; drops: number } | null>("searchAnalytics:applyRetention");
const report = makeFunctionReference<"query", { fromDay: string; toDay: string }, Row | null>("searchAnalytics:report");
const recordEvents = makeFunctionReference<"mutation", { visit: string; events: Row[] }, { accepted: number; dropped: number }>("searchAnalytics:recordClientEvents");
const recordSearch = makeFunctionReference<"mutation", Row, { stored: boolean }>("searchAnalytics:recordSearch");
const addFavorite = makeFunctionReference<"mutation", { projectId: string; search?: { receiptId: string; visit: string } }, { ok: boolean }>("favorites:add");

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const S1 = "sessionAAAAAAAAAAAAAAAA";
const S2 = "sessionBBBBBBBBBBBBBBBB";
const secretFile = path.join(RUNTIME_DIR, "convex", "internal-auth-secret");
const SECRET = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, "utf8").trim() : "";
const ON = {
  NODE_ENV: "development",
  CODEDETAILS_PROJECT_READ_BACKEND: "convex",
  CODEDETAILS_CONVEX_URL: CONVEX_URL,
  CODEDETAILS_SEARCH: "on",
  CODEDETAILS_SEARCH_ANALYTICS: "on",
  CODEDETAILS_INTERNAL_AUTH_SECRET: SECRET,
};
const on = (extra: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries({ ...ON, ...extra })) vi.stubEnv(k, v);
};

async function eventually<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
}

type Hit = { entityId: string; route: string };
async function search(query: string, headers: Record<string, string> = {}) {
  const { GET } = await import("../../src/app/api/search/route.js");
  const res = await GET(new NextRequest(`http://localhost:3100/api/search?${query}`, { headers }));
  const body = JSON.parse(await res.text());
  return { status: res.status, hits: (body.data?.hits ?? []) as Hit[], receipt: body.data?.receipt as { id: string; expiresAt: number } | null };
}
async function postEvents(events: Row[], headers: Record<string, string>) {
  const { POST } = await import("../../src/app/api/search/events/route.js");
  const res = await POST(new NextRequest("http://localhost:3100/api/search/events", { method: "POST", body: JSON.stringify({ events }), headers }));
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : text || null };
}
const searchEvents = async () => (await state()).events.filter((e) => e.type === "search_executed" || e.type === "browse_executed");

describe.skipIf(!convexAvailable() || !SECRET)("D10 search analytics (synthetic)", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
    await warmPersonas([A, B, admin].map((p) => p.subject!));
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    searchLimiter.reset();
  });

  it("with the analytics switch off, search stores nothing and gives no receipt", async () => {
    on({ CODEDETAILS_SEARCH_ANALYTICS: "" });
    const r = await search("q=fixture&final=1", { "x-search-visit": S1 });
    expect(r.status).toBe(200);
    expect(r.receipt).toBeNull();
    await new Promise((res) => setTimeout(res, 500));
    expect((await state()).events).toEqual([]);
    expect((await postEvents([{ type: "results_presented", eventId: "evt-off-0001", receiptId: "x", positions: [0] }], { "x-search-visit": S1 })).status).toBe(404);
  });

  it("the day-one scenario: totals match numbers worked out by hand", async () => {
    on();
    const h = { "x-search-visit": S1 };
    // a) three settled "fixture" searches with a visit, then one keystroke request.
    const a = await search("q=fixture&final=1", h);
    const b = await search("q=fixture&final=1", h);
    const c = await search("q=fixture&final=1", h);
    const d = await search("q=fixture", h);
    for (const r of [a, b, c, d]) {
      expect(r.status).toBe(200);
      expect(r.receipt).not.toBeNull();
      expect(r.hits.length).toBeGreaterThan(2);
    }
    // e) no results; f) "c#": exactly two results; g) browsing; h) a GPC visitor.
    const e = await search("q=zzqx&final=1", h);
    expect(e.receipt).toBeNull();
    const f = await search("q=c%23&final=1", h);
    expect(f.hits.length).toBe(2);
    await search("q=", h);
    const gpc = await search("q=fixture&final=1", { ...h, "sec-gpc": "1" });
    expect(gpc.status).toBe(200);
    expect(gpc.receipt).toBeNull();
    const recorded = await eventually(searchEvents, (ev) => ev.length >= 8);
    expect(recorded.length).toBe(8);
    expect(recorded.filter((ev) => ev.visit === undefined).length, "only the GPC search has no visit").toBe(1);
    expect((await state()).receipts.length, "a, b, c, d and f have receipts; e had no hits; g and h none").toBe(5);

    // Client events: a presented and clicked, b presented, f presented and clicked.
    const target = a.hits.findIndex((x) => !x.route.endsWith("/fixture-listed") && !x.route.endsWith("/fixture-bob-project"));
    const ev = (n: string) => `evt-${n}-${"0".repeat(8)}`;
    const posted = await postEvents(
      [
        { type: "results_presented", eventId: ev("a-shown"), receiptId: a.receipt!.id, positions: [0, 1, 2] },
        { type: "result_clicked", eventId: ev("a-click"), receiptId: a.receipt!.id, entityId: a.hits[target].entityId, position: target },
        { type: "results_presented", eventId: ev("b-shown"), receiptId: b.receipt!.id, positions: [0] },
        { type: "results_presented", eventId: ev("f-shown"), receiptId: f.receipt!.id, positions: [0, 1] },
        { type: "result_clicked", eventId: ev("f-click"), receiptId: f.receipt!.id, entityId: f.hits[1].entityId, position: 1 },
      ],
      h,
    );
    expect(posted).toEqual({ status: 202, body: { accepted: 5, dropped: 0 } });
    // The GPC visitor's events are refused before they reach Convex.
    expect((await postEvents([{ type: "results_presented", eventId: ev("gpc"), receiptId: a.receipt!.id, positions: [0] }], { ...h, dnt: "1" })).status).toBe(204);

    // B favorites the project clicked from a: attributed. A favorite naming c (no click) isn't.
    expect((await clientAs(B.subject!).mutation(addFavorite, { projectId: a.hits[target].entityId, search: { receiptId: a.receipt!.id, visit: S1 } })).ok).toBe(true);
    // (A project B hasn't favorited yet, so the favorite is really created; only the attribution is refused.)
    const unclicked = c.hits.find((x) => x.entityId !== a.hits[target].entityId && !x.route.endsWith("/fixture-listed") && !x.route.endsWith("/fixture-bob-project"))!;
    expect((await clientAs(B.subject!).mutation(addFavorite, { projectId: unclicked.entityId, search: { receiptId: c.receipt!.id, visit: S1 } })).ok).toBe(true);
    expect((await state()).events.filter((x) => x.type === "favorite_created").map((x) => x.entityId)).toEqual([a.hits[target].entityId]);

    const today = dayOf(Date.now());
    const result = await adminClient().mutation(aggregate, { day: today });
    expect(result).toMatchObject({ day: today, truncated: false });
    const daily = (await state()).daily
      .filter((r) => r.day === today)
      .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "updatedAt" && k !== "day")));
    const zero = { zeroResults: 0, lowResults: 0, errors: 0, presented: 0, clickedSearches: 0, clicks: 0, favorites: 0, browses: 0, channel: "web" };
    // Worked out by hand:
    // "fixture": product searches a, b, c and the GPC one = 4; requests add d = 5;
    //   presented a and b = 2; clicked a = 1 search, 1 click; 1 attributed favorite.
    // "(rare)": "zzqx" (1 search, zero results) and "c#" (1 search, two results:
    //   low), presented and clicked once.
    // "(browse)": the empty query.
    expect(daily.sort((x, y) => String(x.query).localeCompare(String(y.query)))).toEqual(
      [
        { ...zero, query: "(browse)", scope: "global", searches: 0, requests: 0, browses: 1 },
        { ...zero, query: RARE_QUERY, scope: "global", searches: 2, requests: 2, zeroResults: 1, lowResults: 1, presented: 1, clickedSearches: 1, clicks: 1 },
        { ...zero, query: "fixture", scope: "global", searches: 4, requests: 5, presented: 2, clickedSearches: 1, clicks: 1, favorites: 1 },
      ].sort((x, y) => x.query.localeCompare(y.query)),
    );

    // The admin report reads the same totals; nobody else gets it.
    const rep = await clientAs(admin.subject!).query(report, { fromDay: today, toDay: today });
    expect(rep).toMatchObject({
      metricVersion: "Code Details metric v1",
      totals: { searches: 6, requests: 7, browses: 1, ctr: 2 / 3, coverage: 3 / 6, favoriteRate: 1 / 3, zeroResultRate: 1 / 6, errorRate: 0 },
    });
    expect((rep as { topQueries: { query: string }[] }).topQueries.map((q) => q.query)).toEqual(["fixture", RARE_QUERY]);
    expect(await clientAs(B.subject!).query(report, { fromDay: today, toDay: today })).toBeNull();
    expect(await anonymousClient().query(report, { fromDay: today, toDay: today })).toBeNull();

    // Nothing stored names a person.
    const text = JSON.stringify(await state());
    for (const secret of [A.subject!, B.subject!, admin.subject!, A.profile!.email, B.profile!.email, "userId", "ownerId", "127.0.0.1"]) expect(text).not.toContain(secret);
  });

  it("client events are checked against their receipt and dropped with a counted reason", async () => {
    on();
    const r = await search("q=fixture&final=1", { "x-search-visit": S1 });
    const id = r.receipt!.id;
    const before = (await state()).drops;
    const count = (drops: State["drops"], reason: string) => drops.filter((d) => d.reason === reason).reduce((n, d) => n + d.count, 0);
    const send = (visit: string, events: Row[]) => anonymousClient().mutation(recordEvents, { visit, events });
    expect(await send(S2, [{ type: "results_presented", eventId: "evt-wrong-visit", receiptId: id, positions: [0] }])).toEqual({ accepted: 0, dropped: 1 });
    expect(await send(S1, [{ type: "result_clicked", eventId: "evt-wrong-position", receiptId: id, entityId: r.hits[0].entityId, position: 1 }])).toEqual({ accepted: 0, dropped: 1 });
    expect(await send(S1, [{ type: "results_presented", eventId: "evt-impossible", receiptId: id, positions: [999] }])).toEqual({ accepted: 0, dropped: 1 });
    expect(await send(S1, [{ type: "results_presented", eventId: "evt-no-receipt", receiptId: "no-such-receipt", positions: [0] }])).toEqual({ accepted: 0, dropped: 1 });
    expect(await send(S1, [{ type: "results_presented", eventId: "evt-first-time", receiptId: id, positions: [0] }])).toEqual({ accepted: 1, dropped: 0 });
    expect(await send(S1, [{ type: "results_presented", eventId: "evt-first-time", receiptId: id, positions: [0] }])).toEqual({ accepted: 0, dropped: 1 });
    const many = Array.from({ length: 21 }, (_, i) => ({ type: "results_presented", eventId: `evt-batch-${String(i).padStart(4, "0")}`, receiptId: id, positions: [0] }));
    expect(await send(S1, many)).toEqual({ accepted: 0, dropped: 21 });
    // An expired receipt (inserted as-is) is refused.
    await adminClient().mutation(insertRows, { receipts: [{ receiptId: "old-receipt", visit: S1, query: "x", scope: "global", hits: [{ entityId: "e", position: 0 }], createdAt: 1, expiresAt: 2 }] });
    expect(await send(S1, [{ type: "results_presented", eventId: "evt-expired-01", receiptId: "old-receipt", positions: [0] }])).toEqual({ accepted: 0, dropped: 1 });
    const after = (await state()).drops;
    for (const [reason, n] of [["visit_mismatch", 1], ["position_mismatch", 2], ["no_receipt", 1], ["duplicate", 1], ["batch_too_large", 21], ["expired", 1]] as const) {
      expect(count(after, reason) - count(before, reason), reason).toBe(n);
    }
  });

  it("a recording failure never touches search: a wrong server secret is refused and counted, the search still answers", async () => {
    on({ CODEDETAILS_INTERNAL_AUTH_SECRET: "x".repeat(40) });
    const before = (await searchEvents()).length;
    const r = await search("q=fixture&final=1", { "x-search-visit": S1 });
    expect(r.status).toBe(200);
    expect(r.hits.length).toBeGreaterThan(0);
    const drops = await eventually(async () => (await state()).drops.filter((d) => d.reason === "unauthorized"), (d) => d.length > 0);
    expect(drops.length).toBeGreaterThan(0);
    expect((await searchEvents()).length).toBe(before);
    expect(await anonymousClient().mutation(recordSearch, {
      serverSecret: "nope", receiptId: "r", browse: false, product: true, query: "x", scope: "global", sort: "relevance", filterCount: 0, page: 0, status: "ok", hits: [], hasMore: false, latencyMs: 1,
    })).toEqual({ stored: false, receipt: false });
  });

  it("retention removes expired receipts, raw events past 90 days and totals past 25 months, and keeps the rest", async () => {
    const now = Date.now();
    const old = now - 91 * 24 * 60 * 60 * 1000;
    await adminClient().mutation(insertRows, {
      receipts: [{ receiptId: "gone-receipt", visit: S1, query: "x", scope: "global", hits: [], createdAt: 1, expiresAt: now - 1000 }],
      events: [{ eventId: "evt-ancient-0001", type: "browse_executed", channel: "web", day: dayOf(old), acceptedAt: old }],
      daily: [{ day: "2020-01-01", query: "old", scope: "global", channel: "web", searches: 1, requests: 1, zeroResults: 0, lowResults: 0, errors: 0, presented: 0, clickedSearches: 0, clicks: 0, favorites: 0, browses: 0, updatedAt: 1 }],
      drops: [{ day: "2020-01-01", reason: "invalid", count: 3 }],
    });
    const before = await state();
    const r = await adminClient().mutation(purge, {});
    expect(r).toMatchObject({ events: 1, daily: 1, drops: 1 });
    expect(r!.receipts).toBeGreaterThanOrEqual(1);
    const after = await state();
    expect(after.receipts.map((x) => x.receiptId)).not.toContain("gone-receipt");
    expect(after.events.map((x) => x.eventId)).not.toContain("evt-ancient-0001");
    expect(after.daily.map((x) => x.day)).not.toContain("2020-01-01");
    expect(after.events.length).toBe(before.events.length - 1);
    expect(after.daily.length).toBe(before.daily.length - 1);
  });
});
