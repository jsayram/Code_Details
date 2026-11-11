// D09 S02b: search v1 request rules, the cursor envelope, the rate limiter and
// the proxy entry for /api/search. Pure; the Convex side is in
// tests/integration/d09-convex-search.test.ts.

import { describe, expect, it } from "vitest";
import {
  MAX_PAGES,
  checkRequest,
  cursorKey,
  decodeCursor,
  dedupeAgainst,
  effectiveSort,
  encodeCursor,
  nextCursor,
  parseSearchParams,
  shortHash,
} from "@/backend/search/search-rules";
import { TokenBucketLimiter, clientKey } from "@/backend/search/rate-limit";
import { isPublicPath } from "@/backend/auth/proxy-rules";
import { searchBackendUrl } from "@/backend/search/search-client";

describe("checkRequest", () => {
  it("accepts a plain search and a plain browse", () => {
    expect(checkRequest({ q: "next.js auth" })).toEqual([]);
    expect(checkRequest({ q: "", sort: "newest", pageSize: 48, tags: ["Go"] })).toEqual([]);
  });
  it.each([
    [{ q: "x".repeat(201) }, "q"],
    [{ q: "a b c d e f g h i" }, "q"],
    [{ q: "x", sort: "random" as never }, "sort"],
    [{ q: "", sort: "relevance" as const }, "sort"],
    [{ q: "x", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, "tags"],
    [{ q: "x", pageSize: 49 }, "pageSize"],
    [{ q: "x", pageSize: 0 }, "pageSize"],
    [{ q: "x", pageSize: 1.5 }, "pageSize"],
    [{ q: "x", handle: "" }, "handle"],
  ])("refuses %o on %s", (args, field) => {
    expect(checkRequest(args).map((i) => i.field)).toContain(field);
  });
  it("defaults to relevance with text and newest without", () => {
    expect(effectiveSort({ q: " go " })).toBe("relevance");
    expect(effectiveSort({ q: "  " })).toBe("newest");
    expect(effectiveSort({ q: "go", sort: "popular" })).toBe("popular");
  });
});

describe("cursor envelope", () => {
  const args = { q: "next.js", category: "web", tags: ["B", "a"], pageSize: 24 };

  it("round-trips and binds to the request, case- and order-insensitively for tags", () => {
    const c = nextCursor(args, 0, ["id1", "id2"], true, "convex-cursor")!;
    const e = decodeCursor(c, { ...args, tags: ["A", "b"] })!;
    expect(e).toMatchObject({ p: 1, c: "convex-cursor", s: [shortHash("id1"), shortHash("id2")] });
  });
  it.each([
    ["another query", { ...args, q: "react" }],
    ["another filter", { ...args, category: "mobile" }],
    ["another sort", { ...args, sort: "newest" as const }],
    ["another page size", { ...args, pageSize: 48 }],
    ["another creator", { ...args, handle: "someone" }],
  ])("refuses a cursor replayed against %s", (_, other) => {
    expect(decodeCursor(nextCursor(args, 0, ["x"], true)!, other)).toBeNull();
  });
  it("refuses garbage, forged pages and oversized cursors", () => {
    const key = cursorKey(args);
    expect(decodeCursor("not-base64!", args)).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1, k: key, p: MAX_PAGES, s: [] }), args)).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1, k: key, p: 0, s: [] }), args)).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1, k: key, p: 2, s: ["nothex!!"] }), args)).toBeNull();
    expect(decodeCursor("a".repeat(5000), args)).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1, k: key, p: 2, s: [] }), args)).not.toBeNull();
  });
  it("stops at the page cap and at the end", () => {
    expect(nextCursor(args, MAX_PAGES - 2, ["x"], true)).not.toBeNull();
    expect(nextCursor(args, MAX_PAGES - 1, ["x"], true)).toBeNull();
    expect(nextCursor(args, 0, ["x"], false)).toBeNull();
  });
  it("drops rows that were on the previous page", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(dedupeAgainst(rows, [shortHash("b")]).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("parseSearchParams", () => {
  it("reads repeated and comma-separated tags, and leaves validation to checkRequest", () => {
    const a = parseSearchParams(new URLSearchParams("q=go&tags=A,B&tag=C&pageSize=12&sort=popular&handle=x&category=web&cursor=abc"));
    expect(a).toEqual({ q: "go", tags: ["A", "B", "C"], pageSize: 12, sort: "popular", handle: "x", category: "web", cursor: "abc" });
    expect(parseSearchParams(new URLSearchParams(""))).toEqual({ q: "" });
    expect(checkRequest(parseSearchParams(new URLSearchParams("q=go&pageSize=abc")))).toEqual([expect.objectContaining({ field: "pageSize" })]);
  });
});

describe("rate limit", () => {
  it("allows a burst of 30, then 10 a second", () => {
    const l = new TokenBucketLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(l.take("k", t).ok).toBe(true);
    expect(l.take("k", t)).toEqual({ ok: false, retryAfter: 1 });
    expect(l.take("other", t).ok).toBe(true);
    for (let i = 0; i < 10; i++) expect(l.take("k", t + 1000).ok, `refill ${i}`).toBe(true);
    expect(l.take("k", t + 1000).ok).toBe(false);
  });
  it("keeps at most maxKeys buckets", () => {
    const l = new TokenBucketLimiter(10, 1, 2);
    l.take("a", 0);
    l.take("b", 0);
    l.take("c", 0);
    expect(l.take("a", 0).ok, "a was evicted, so it starts full again").toBe(true);
  });
  it("trusts X-Forwarded-For only behind a configured proxy", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientKey(h, {})).toBe("anonymous");
    expect(clientKey(h, { CODEDETAILS_AUTH_TRUSTED_PROXIES: "10.0.0.1" })).toBe("ip:203.0.113.9");
  });
});

describe("proxy", () => {
  it("search is public (decision 3); the user directory is not", () => {
    expect(isPublicPath("/api/search")).toBe(true);
    expect(isPublicPath("/api/search/facets")).toBe(true);
    expect(isPublicPath("/api/search/anything-else")).toBe(false);
    expect(isPublicPath("/users")).toBe(false);
    expect(isPublicPath("/api/profiles")).toBe(false);
  });
});

describe("search switch (S02f: on by default)", () => {
  const convex = { NODE_ENV: "development", CODEDETAILS_PROJECT_READ_BACKEND: "convex", CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3330" };
  it("is on with nothing set, off only with CODEDETAILS_SEARCH=off, and never without the Convex read", () => {
    expect(searchBackendUrl(convex)).toBe("http://127.0.0.1:3330");
    expect(searchBackendUrl({ ...convex, CODEDETAILS_SEARCH: "on" })).toBe("http://127.0.0.1:3330");
    expect(searchBackendUrl({ ...convex, CODEDETAILS_SEARCH: "off" })).toBeNull();
    expect(searchBackendUrl({ ...convex, CODEDETAILS_PROJECT_READ_BACKEND: "supabase" })).toBeNull();
    expect(searchBackendUrl({ ...convex, NODE_ENV: "production" })).toBeNull();
  });
});
