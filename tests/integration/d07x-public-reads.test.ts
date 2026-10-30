// D07x-b: the other public lists on Convex under both development switches:
// the community category counts, one owner's shared-projects grid and its
// category counts, and the tag list. Convex is checked against the fixtures,
// then each route is called in-process with the switches on and compared with
// the same route on Supabase (switches off), same fixtures.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { makeFunctionReference } from "convex/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { CONVEX_URL, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const publicCategoryCounts = makeFunctionReference<"query", { handle?: string }, Record<string, number> | null>("projects:publicCategoryCounts");
const listAll = makeFunctionReference<"query", Record<string, never>, { id: string; name: string; count: number }[]>("tags:listAll");

const set = generateFixtures();
const { a: A, b: B, deleting } = set.personas;
const listed = set.projects.filter((p) => !p.purged && !p.deletedAt && p.visibility === "public");
const countBy = (projects: typeof listed) =>
  projects.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.category]: (acc[p.category] ?? 0) + 1 }), {});

const SWITCHES = {
  NODE_ENV: "development",
  CODEDETAILS_PROJECT_READ_BACKEND: "convex",
  CODEDETAILS_AUTH_BACKEND: "better-auth",
  CODEDETAILS_CONVEX_URL: CONVEX_URL,
  CODEDETAILS_CONVEX_SITE_URL: CONVEX_URL.replace(/:(\d+)$/, (_, port) => `:${Number(port) + 1}`),
};
const switchesOn = () => {
  for (const [k, v] of Object.entries(SWITCHES)) vi.stubEnv(k, v);
};

describe.skipIf(!convexAvailable())("D07x-b Convex public reads", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("category counts cover listed projects only, community-wide and per handle", async () => {
    const c = anonymousClient();
    expect(await c.query(publicCategoryCounts, {})).toEqual(countBy(listed));
    expect(await c.query(publicCategoryCounts, { handle: B.profile!.username })).toEqual({ web: 1 });
    expect(await c.query(publicCategoryCounts, { handle: A.profile!.username })).toEqual(countBy(listed.filter((p) => p.ownerKey === "a")));
    expect(await c.query(publicCategoryCounts, { handle: "fixture-nobody" })).toBeNull();
    expect(await c.query(publicCategoryCounts, { handle: deleting.profile!.username })).toBeNull();
  });

  it("the tag list has every tag with its listed-project count, most used first", async () => {
    const tags = await anonymousClient().query(listAll, {});
    const expected = set.tags.map((t) => ({ name: t.name, count: listed.filter((p) => p.tagIds.includes(t.id)).length }));
    expect(tags.map(({ name, count }) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name))).toEqual(
      expected.sort((x, y) => x.name.localeCompare(y.name)),
    );
    const counts = tags.map((t) => t.count);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  describe.skipIf(!testDbAvailable())("routes: switches on (Convex) vs off (Supabase)", () => {
    let sql: postgres.Sql;
    beforeAll(async () => {
      sql = await connectTestDb();
      await cleanupFixtures(sql);
      await loadFixtures(sql, set);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });
    afterAll(async () => {
      signInAs(null);
      await cleanupFixtures(sql);
      await sql.end();
    });

    const both = async <T,>(call: () => Promise<T>) => {
      const supabase = await call();
      switchesOn();
      const convex = await call();
      vi.unstubAllEnvs();
      return { supabase, convex };
    };
    const json = async (res: Response) => ({ status: res.status, body: JSON.parse(await res.text()) });
    // Supabase has no visibility column: fixture-private (A's, web, tagged
    // Next.js) is an ordinary project there. That one row is the expected gap.
    const privateFixture = set.projects.find((p) => p.slug === "fixture-private")!;

    it("community category counts", async () => {
      const { GET } = await import("../../src/app/api/categories/counts/route.js");
      const { supabase, convex } = await both(async () => json(await GET(new NextRequest("http://localhost:3100/api/categories/counts"))));
      expect(convex.status).toBe(200);
      expect(convex.body.data).toEqual({ ...supabase.body.data, web: supabase.body.data.web - 1 });
    });

    it("shared-projects category counts, including the unknown-handle 404", async () => {
      const { GET } = await import("../../src/app/api/shared-projects/[username]/categories/route.js");
      const call = (username: string) => async () =>
        json(await GET(new NextRequest(`http://localhost:3100/api/shared-projects/${username}/categories`), { params: Promise.resolve({ username }) }));
      const b = await both(call(B.profile!.username));
      expect(b.convex).toEqual(b.supabase);
      const a = await both(call(A.profile!.username));
      expect(a.convex.body.data).toEqual({ ...a.supabase.body.data, web: a.supabase.body.data.web - 1 });
      const nobody = await both(call("fixture-nobody"));
      expect(nobody.convex.status).toBe(404);
      expect(nobody.convex.status).toBe(nobody.supabase.status);
    });

    type SharedRow = { project: { slug: string; title: string; created_at: string; updated_at: string; total_favorites: string }; profile: { username: string } | null; tags: (string | null)[] };
    const sharedCall = (username: string, query = "", limit = 50) => async () => {
      const { GET } = await import("../../src/app/api/shared-projects/[username]/route.js");
      return json(await GET(new NextRequest(`http://localhost:3100/api/shared-projects/${username}?limit=${limit}&${query}`), { params: Promise.resolve({ username }) }));
    };
    // DEF-D07X-SHAREDNULL: array_agg over a project with no tags gives a
    // literal "NULL" tag on Supabase; Convex gives none.
    const realTags = (r: SharedRow) => r.tags.filter((t): t is string => !!t && t !== "NULL");
    const norm = (rows: SharedRow[]) =>
      rows
        .filter((r) => r.project.slug !== privateFixture.slug)
        .map((r) => ({ slug: r.project.slug, favorites: Number(r.project.total_favorites), owner: r.profile?.username ?? null, tags: realTags(r).sort() }))
        .sort((x, y) => x.slug.localeCompare(y.slug));

    it("shared-projects grid: same rows, tags, counts and owner for A and B; unknown handle is empty", async () => {
      for (const persona of [A, B]) {
        const { supabase, convex } = await both(sharedCall(persona.profile!.username));
        expect(convex.status).toBe(200);
        expect(norm(convex.body.data.data)).toEqual(norm(supabase.body.data.data));
        expect(convex.body.data.data.map((r: SharedRow) => r.project.slug)).not.toContain(privateFixture.slug);
        expect(JSON.stringify(convex.body)).not.toContain(persona.profile!.email);
      }
      const nobody = await both(sharedCall("fixture-nobody"));
      expect(nobody.convex.body.data).toEqual(nobody.supabase.body.data);
    });

    const key: Record<string, (r: SharedRow) => unknown> = {
      newest: (r) => Date.parse(r.project.created_at),
      oldest: (r) => Date.parse(r.project.created_at),
      "recently-edited": (r) => Date.parse(r.project.updated_at),
      popular: (r) => Number(r.project.total_favorites),
      "least-favorited": (r) => Number(r.project.total_favorites),
      alphabetical: (r) => r.project.title.toLowerCase(),
      "alphabetical-desc": (r) => r.project.title.toLowerCase(),
      "most-tagged": (r) => realTags(r).length,
    };
    for (const sortBy of Object.keys(key)) {
      it(`shared-projects sort ${sortBy} orders by the same key, and pages add up`, async () => {
        const { supabase, convex } = await both(sharedCall(A.profile!.username, `sortBy=${sortBy}`));
        const rows = (r: { body: { data: { data: SharedRow[] } } }) => r.body.data.data.filter((x) => x.project.slug !== privateFixture.slug);
        expect(rows(convex).map(key[sortBy])).toEqual(rows(supabase).map(key[sortBy]));
        switchesOn();
        const page2 = await sharedCall(A.profile!.username, `sortBy=${sortBy}&page=2`, 3)();
        vi.unstubAllEnvs();
        expect(page2.body.data.data.map((r: SharedRow) => r.project.slug)).toEqual(convex.body.data.data.slice(3, 6).map((r: SharedRow) => r.project.slug));
        expect(page2.body.data.pagination).toMatchObject({ total: convex.body.data.data.length, page: 2, limit: 3 });
      });
    }

    it("the tag list: same names; counts differ only by the private fixture", async () => {
      const { searchTagsAction } = await import("../../src/app/actions/tags.js");
      const { supabase, convex } = await both(() => searchTagsAction(""));
      const byName = (tags: { name: string; count?: number }[]) => Object.fromEntries(tags.map((t) => [t.name, t.count ?? 0]));
      const s = byName(supabase);
      const c = byName(convex);
      expect(Object.keys(c).sort()).toEqual(Object.keys(s).sort());
      for (const tag of set.tags) {
        expect(s[tag.name] - c[tag.name], tag.name).toBe(privateFixture.tagIds.includes(tag.id) ? 1 : 0);
      }
      switchesOn();
      const filtered = await searchTagsAction("rea");
      vi.unstubAllEnvs();
      expect(filtered.map((t) => t.name).sort()).toEqual(set.tags.filter((t) => t.name.toLowerCase().includes("rea")).map((t) => t.name).sort());
    });
  });
});
