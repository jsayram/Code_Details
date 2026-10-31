// D09 S02b: search:projects and search:facets on the task-owned test backend,
// then GET /api/search and /api/search/facets in-process. Signed-out and
// signed-in callers get the same listed projects; private, deleted and purged
// projects are never reachable; unknown filters are refused; cursors are
// bound to their search and never repeat a project.
import { NextRequest } from "next/server";
import { makeFunctionReference } from "convex/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { CONVEX_URL, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, warmPersonas } from "../fixtures/convex-auth";
import { SEARCH_HIT_KEYS } from "@/backend/search/public-search-doc";
import { searchLimiter } from "@/backend/search/search-client";
import type { FacetsResult, SearchResult } from "../../convex/search";

type Args = Record<string, unknown>;
const projects = makeFunctionReference<"query", Args, SearchResult>("search:projects");
const facets = makeFunctionReference<"query", Args, FacetsResult>("search:facets");

const set = generateFixtures();
const { a: A, b: B, deleting } = set.personas;
const eligible = set.projects.filter((p) => !p.purged && !p.deletedAt && p.visibility === "public");
const eligibleSlugs = new Set(eligible.map((p) => p.slug));
const INELIGIBLE = set.projects.filter((p) => !eligibleSlugs.has(p.slug)).map((p) => p.slug);
const slugOf = (route: string) => decodeURIComponent(route.replace(/^\/projects\//, ""));

const ok = (r: SearchResult) => {
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
  return r;
};
const anon = (args: Args) => anonymousClient().query(projects, { q: "", ...args });
const slugs = async (args: Args) => ok(await anon(args)).hits.map((h) => slugOf(h.route));

/** Every page of a search, following nextCursor. */
async function allPages(args: Args) {
  const out: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 25; i++) {
    const r = ok(await anon({ ...args, cursor }));
    out.push(...r.hits.map((h) => slugOf(h.route)));
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return out;
}

describe.skipIf(!convexAvailable())("D09 S02b Convex search", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
    await warmPersonas([A, B].map((p) => p.subject!));
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("signed out and signed in get the same public hits, with only the public hit fields", async () => {
    const signedOut = ok(await anon({ q: "fixture", pageSize: 48 }));
    const signedIn = ok(await clientAs(A.subject!).query(projects, { q: "fixture", pageSize: 48 }));
    expect(signedIn.hits).toEqual(signedOut.hits);
    expect(signedOut.hits.length).toBeGreaterThan(3);
    for (const h of signedOut.hits) {
      expect(Object.keys(h).sort()).toEqual([...SEARCH_HIT_KEYS].sort());
      expect(eligibleSlugs.has(slugOf(h.route)), h.route).toBe(true);
    }
    const json = JSON.stringify(signedOut);
    expect(json).not.toMatch(/ownerId|searchText|rankingFavoriteCount|@synthetic|user_/);
  });

  it("no query, sort or filter reaches a private, deleted or purged project", async () => {
    for (const args of [
      { q: "fixture", pageSize: 48 },
      { q: "private", pageSize: 48 },
      { q: "deleted", pageSize: 48 },
      { q: "", pageSize: 48 },
      { q: "", sort: "popular", pageSize: 48 },
      { q: "next.js", sort: "newest", pageSize: 48 },
      { q: "", tags: ["Next.js"], pageSize: 48 },
      { q: "", handle: A.profile!.username, pageSize: 48 },
    ]) {
      const found = await slugs(args);
      for (const slug of INELIGIBLE) expect(found, `${JSON.stringify(args)}: ${slug}`).not.toContain(slug);
    }
    const f = await anonymousClient().query(facets, { q: "" });
    if (!f.ok) throw new Error("facets refused");
    expect(f.total.value).toBe(eligible.length);
  });

  it("keeps C, C++ and C# apart and understands aliases", async () => {
    const csharp = await slugs({ q: "c#" });
    expect(csharp).toEqual(expect.arrayContaining(["fixture-one-tag", "fixture-fifteen-tags"]));
    expect(csharp).not.toContain("fixture-listed");
    expect(await slugs({ q: "c" })).not.toContain("fixture-one-tag");
    expect(await slugs({ q: "postgresql" })).toContain("fixture-listed");
    expect((await slugs({ q: "golang" })).sort()).toEqual(["fixture-fifteen-tags", "fixture-legacy-owner"]);
    expect(ok(await anon({ q: "typscript" })).applied.correctedQuery).toBe("typescript");
  });

  it("refuses unknown categories, tags and creators instead of ignoring them", async () => {
    const r = await anon({ q: "x", category: "nope", tags: ["Next.js", "no-such-tag"], handle: "fixture-nobody" });
    expect(r).toMatchObject({ ok: false, code: "unknown_filter" });
    if (r.ok) return;
    expect(r.issues.map((i) => i.field).sort()).toEqual(["category", "handle", "tags"]);
    expect(await anon({ q: "x", handle: deleting.profile!.username })).toMatchObject({ ok: false, code: "unknown_filter" });
    expect(await anon({ q: "x", sort: "random" })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await anon({ q: "x", pageSize: 49 })).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("creator scope, category filter and tags (AND)", async () => {
    expect(await slugs({ q: "fixture", handle: B.profile!.username })).toEqual(["fixture-bob-project"]);
    expect((await slugs({ q: "", category: "web", pageSize: 48 })).length).toBe(eligible.filter((p) => p.category === "web").length);
    const both = ok(await anon({ q: "", tags: ["Next.js", "Postgres"] }));
    expect(both.hits.map((h) => slugOf(h.route)).sort()).toEqual(["fixture-fifteen-tags", "fixture-listed"]);
    expect(both.total).toEqual({ value: 2, relation: "eq" });
    expect(await slugs({ q: "", tags: ["next.js"] })).toContain("fixture-listed");
  });

  it("browsing pages newest first with a stable tie-breaker, every project once", async () => {
    const pages = await allPages({ q: "", pageSize: 3 });
    expect(new Set(pages).size).toBe(pages.length);
    expect(new Set(pages)).toEqual(eligibleSlugs);
    const hits = ok(await anon({ q: "", pageSize: 48 })).hits;
    for (let i = 1; i < hits.length; i++) {
      const [x, y] = [hits[i - 1], hits[i]];
      expect(x.createdAt > y.createdAt || (x.createdAt === y.createdAt && x.entityId < y.entityId), `${x.route} before ${y.route}`).toBe(true);
    }
  });

  it("relevance pages never repeat a project and end with a null cursor", async () => {
    const pages = await allPages({ q: "fixture", pageSize: 2 });
    expect(new Set(pages).size).toBe(pages.length);
    const once = await slugs({ q: "fixture", pageSize: 48 });
    expect(new Set(pages)).toEqual(new Set(once));
  });

  it("a cursor only works for the search that issued it", async () => {
    const first = ok(await anon({ q: "fixture", pageSize: 2 }));
    expect(first.nextCursor).not.toBeNull();
    expect(await anon({ q: "next.js", pageSize: 2, cursor: first.nextCursor })).toMatchObject({ ok: false, code: "invalid_cursor" });
    expect(await anon({ q: "fixture", pageSize: 3, cursor: first.nextCursor })).toMatchObject({ ok: false, code: "invalid_cursor" });
    expect(ok(await anon({ q: "fixture", pageSize: 2, cursor: first.nextCursor })).hits.length).toBeGreaterThan(0);
  });

  it("popular ranks by favorites from other people, not the public counter", async () => {
    const top = (await slugs({ q: "", sort: "popular", pageSize: 2 })).sort();
    expect(top).toEqual(["fixture-bob-project", "fixture-listed"]);
  });

  it("facets count the whole matching set, exactly below 1,024", async () => {
    const f = await anonymousClient().query(facets, { q: "", handle: A.profile!.username });
    if (!f.ok) throw new Error("facets refused");
    const mine = eligible.filter((p) => p.ownerKey === "a");
    expect(f.facetCounts).toBe("exact");
    expect(f.total).toEqual({ value: mine.length, relation: "eq" });
    expect(f.category).toEqual(mine.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category]: (m[p.category] ?? 0) + 1 }), {}));
    const nextjs = set.tags.find((t) => t.name === "Next.js")!.id;
    expect(f.tags.find((t) => t.name === "Next.js")?.count).toBe(mine.filter((p) => p.tagIds.includes(nextjs)).length);
    expect(await anonymousClient().query(facets, { q: "", tags: ["nope"] })).toMatchObject({ ok: false, code: "unknown_filter" });
  });

  describe("routes", () => {
    const ON = {
      NODE_ENV: "development",
      CODEDETAILS_PROJECT_READ_BACKEND: "convex",
      CODEDETAILS_CONVEX_URL: CONVEX_URL,
      CODEDETAILS_SEARCH: "on",
    };
    const on = () => {
      for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);
    };
    afterEach(() => {
      vi.unstubAllEnvs();
    });
    const get = async (path: string) => {
      const { GET } = path.startsWith("/api/search/facets") ? await import("../../src/app/api/search/facets/route.js") : await import("../../src/app/api/search/route.js");
      const res = await GET(new NextRequest(`http://localhost:3100${path}`));
      const text = await res.text();
      return { status: res.status, retryAfter: res.headers.get("retry-after"), body: text.startsWith("{") ? JSON.parse(text) : text };
    };

    it("on by default: no CODEDETAILS_SEARCH at all serves search", async () => {
      for (const [k, v] of Object.entries(ON)) if (k !== "CODEDETAILS_SEARCH") vi.stubEnv(k, v);
      vi.stubEnv("CODEDETAILS_SEARCH", undefined as unknown as string);
      searchLimiter.reset();
      expect((await get("/api/search?q=fixture")).status).toBe(200);
    });

    it("404 with CODEDETAILS_SEARCH=off (the rollback), even with Convex reads on", async () => {
      for (const [k, v] of Object.entries({ ...ON, CODEDETAILS_SEARCH: "off" })) vi.stubEnv(k, v);
      expect((await get("/api/search?q=fixture")).status).toBe(404);
      expect((await get("/api/search/facets?q=fixture")).status).toBe(404);
    });

    it("serves the v1 contract with the switch on", async () => {
      on();
      searchLimiter.reset();
      const r = await get("/api/search?q=c%23&pageSize=5");
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ apiVersion: 1, sort: "relevance", generation: { ranking: 1, projection: 1 } });
      expect(r.body.data.hits.map((h: { route: string }) => slugOf(h.route))).toContain("fixture-one-tag");
      expect(r.body.data.ok).toBeUndefined();
      const f = await get("/api/search/facets?q=&tags=Next.js");
      expect(f.status).toBe(200);
      expect(f.body.data.facetCounts).toBe("exact");
    });

    it("400 for bad or unknown parameters, as RFC 7807", async () => {
      on();
      searchLimiter.reset();
      const unknown = await get("/api/search?q=x&tags=no-such-tag");
      expect(unknown.status).toBe(400);
      expect(unknown.body.error).toMatchObject({ status: 400, detail: "unknown_filter" });
      expect(unknown.body.error.errors).toEqual([{ field: "tags", message: 'Unknown tag "no-such-tag"' }]);
      const bad = await get("/api/search?q=x&pageSize=500");
      expect(bad.status).toBe(400);
      expect(bad.body.error.detail).toBe("invalid_request");
      expect((await get("/api/search?q=x&cursor=garbage")).body.error.detail).toBe("invalid_cursor");
    });

    it("429 with Retry-After past the burst", async () => {
      on();
      searchLimiter.reset();
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await get("/api/search?q=&pageSize=1&sort=bogus")).status);
      expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
      const last = await get("/api/search?q=fixture");
      expect(last.status).toBe(429);
      expect(Number(last.retryAfter)).toBeGreaterThanOrEqual(1);
    });
  });
});
