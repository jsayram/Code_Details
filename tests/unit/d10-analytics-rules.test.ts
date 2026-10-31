// D10 day one: the analytics rules. The daily totals are checked against
// numbers worked out by hand for a small event log, not against the code.
import { describe, expect, it } from "vitest";
import {
  RARE_QUERY,
  aggregateDay,
  clampClientAt,
  dailyRetentionStart,
  dayOf,
  optedOut,
  redactQuery,
  validVisitToken,
  type StoredEvent,
} from "@/backend/search/analytics-rules";

describe("redactQuery", () => {
  it.each([
    ["  Next.JS   Auth ", "next.js auth"],
    ["contact ada@example.test please", "contact [email] please"],
    ["see https://x.test/p?token=abc123", "see [url]"],
    ["www.example.test/docs", "[url]"],
    ["call 555 123 4567 now", "call [number] now"],
    ["key sk_live_4eC39HqLyjWDarjtT1zdp7dc", "key [key]"],
    ["c++ c# .net", "c++ c# .net"],
    ["typescriptreactnativeexpo", "typescriptreactnativeexpo"],
  ])("%j -> %j", (q, out) => {
    expect(redactQuery(q)).toBe(out);
  });
});

describe("small rules", () => {
  it("visit tokens: URL-safe, 16-64 characters", () => {
    expect(validVisitToken("abcDEF0123456789")).toBe(true);
    expect(validVisitToken("short")).toBe(false);
    expect(validVisitToken("x".repeat(65))).toBe(false);
    expect(validVisitToken("has space in it okay")).toBe(false);
    expect(validVisitToken(null)).toBe(false);
  });
  it("GPC and DNT opt out", () => {
    expect(optedOut(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(new Headers({ dnt: "1" }))).toBe(true);
    expect(optedOut(new Headers({ dnt: "0" }))).toBe(false);
    expect(optedOut(new Headers())).toBe(false);
  });
  it("client clocks within 10 minutes are kept, others replaced and flagged", () => {
    const now = Date.UTC(2026, 9, 30, 12);
    expect(clampClientAt(now - 9 * 60_000, now)).toEqual({ at: now - 9 * 60_000, skewed: false });
    expect(clampClientAt(now + 11 * 60_000, now)).toEqual({ at: now, skewed: true });
    expect(clampClientAt(undefined, now)).toEqual({ at: now, skewed: false });
  });
  it("days are UTC; daily totals are kept 25 months", () => {
    expect(dayOf(Date.UTC(2026, 9, 30, 23, 59))).toBe("2026-10-30");
    expect(dailyRetentionStart(Date.UTC(2026, 9, 30))).toBe("2024-09-30");
  });
});

describe("aggregateDay", () => {
  const s = (receiptId: string | undefined, query: string, extra: Partial<StoredEvent> = {}): StoredEvent => ({
    type: "search_executed", receiptId, query, scope: "global", status: "ok", product: true, channel: "web", ...extra,
  });
  const e = (type: StoredEvent["type"], receiptId: string): StoredEvent => ({ type, receiptId, channel: "web" });

  it("matches totals worked out by hand", () => {
    const events: StoredEvent[] = [
      // "react": 4 product searches (r1-r4) and one keystroke request (r5).
      s("r1", "react"), s("r2", "react"), s("r3", "react"), s("r4", "react", { status: "error" }), s("r5", "react", { product: false }),
      e("results_presented", "r1"), e("results_presented", "r1"), e("results_presented", "r2"),
      e("result_clicked", "r1"), e("result_clicked", "r1"), e("favorite_created", "r1"),
      // A click without a presentation counts as a click, not as a clicked search.
      e("result_clicked", "r3"),
      // Events on the keystroke request and on unknown receipts don't count.
      e("results_presented", "r5"), e("result_clicked", "r5"), e("result_clicked", "nope"),
      // Two one-off queries become "(rare)": one with no results, one with two.
      s("z1", "haskell", { zero: true }), s("c1", "c#", { low: true }), e("results_presented", "c1"), e("result_clicked", "c1"),
      // A creator-scoped search is its own row, also rare.
      s("p1", "react", { scope: "creator" }),
      { type: "browse_executed", scope: "global", channel: "web" }, { type: "browse_executed", scope: "global", channel: "web" },
    ];
    const base = { requests: 0, zeroResults: 0, lowResults: 0, errors: 0, presented: 0, clickedSearches: 0, clicks: 0, favorites: 0, browses: 0, channel: "web" };
    expect(aggregateDay(events)).toEqual([
      { ...base, query: "react", scope: "global", searches: 4, requests: 5, errors: 1, presented: 2, clickedSearches: 1, clicks: 3, favorites: 1 },
      { ...base, query: RARE_QUERY, scope: "global", searches: 2, requests: 2, zeroResults: 1, lowResults: 1, presented: 1, clickedSearches: 1, clicks: 1 },
      { ...base, query: RARE_QUERY, scope: "creator", searches: 1, requests: 1 },
      { ...base, query: "(browse)", scope: "global", searches: 0, browses: 2 },
    ]);
  });

  it("an empty day has no rows", () => {
    expect(aggregateDay([])).toEqual([]);
  });
});
