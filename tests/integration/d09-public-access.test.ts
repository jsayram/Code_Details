// D09 S02c: the routes behind the newly public pages, in-process with the
// Convex switches on. Signed out, the public variants answer listed projects
// only, and every personal variant (mine, favorites, deleted, and the
// personal counts) is a 401 rather than an empty or public list.
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { CONVEX_URL, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { nextCacheDouble, sessionDouble, signInAs } from "../support/next-doubles";

// Outside Next there is no request cookie, so the token reads would throw.
// Here they answer as a request with no Better Auth token does: the viewer
// queries run anonymously (the public list) or come back empty (personal).
vi.mock("@/lib/auth-server", async (importOriginal) => {
  const base = await sessionDouble(importOriginal);
  const { fetchQuery } = await import("convex/nextjs");
  return {
    ...base,
    viewerQuery: vi.fn(async () => null),
    viewerQueryWithArgs: vi.fn(async (query: never, args: never) => ({ result: await fetchQuery(query, args, { url: process.env.CODEDETAILS_CONVEX_URL }) })),
  };
});
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const { a: A } = set.personas;
const eligible = set.projects.filter((p) => !p.purged && !p.deletedAt && p.visibility === "public");
const eligibleSlugs = new Set(eligible.map((p) => p.slug));
const INELIGIBLE = set.projects.filter((p) => !eligibleSlugs.has(p.slug)).map((p) => p.slug);

const SWITCHES = {
  NODE_ENV: "development",
  CODEDETAILS_PROJECT_READ_BACKEND: "convex",
  CODEDETAILS_AUTH_BACKEND: "better-auth",
  CODEDETAILS_CONVEX_URL: CONVEX_URL,
  CODEDETAILS_CONVEX_SITE_URL: CONVEX_URL.replace(/:(\d+)$/, (_, port) => `:${Number(port) + 1}`),
};

describe.skipIf(!convexAvailable())("D09 S02c signed-out access", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    signInAs(null);
    await clearConvexFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    signInAs(null);
  });
  const on = () => {
    for (const [k, v] of Object.entries(SWITCHES)) vi.stubEnv(k, v);
  };

  const projects = async (query: string) => {
    const { GET } = await import("../../src/app/api/projects/route.js");
    const res = await GET(new NextRequest(`http://localhost:3100/api/projects?${query}`));
    const body = JSON.parse(await res.text());
    return { status: res.status, slugs: Array.isArray(body.data) ? (body.data as { slug: string }[]).map((p) => p.slug) : [] };
  };
  const counts = async (query: string) => {
    const { GET } = await import("../../src/app/api/categories/counts/route.js");
    const res = await GET(new NextRequest(`http://localhost:3100/api/categories/counts${query ? `?${query}` : ""}`));
    return { status: res.status, body: JSON.parse(await res.text()) };
  };

  it("signed out: the community, portfolio, category and tag lists show listed projects only", async () => {
    on();
    for (const q of ["showAll=true&limit=100", `username=${A.profile!.username}&limit=100`, "showAll=true&category=web&limit=100", "showAll=true&tags=Next.js&limit=100"]) {
      const r = await projects(q);
      expect(r.status, q).toBe(200);
      expect(r.slugs.length, q).toBeGreaterThan(0);
      for (const slug of r.slugs) expect(eligibleSlugs.has(slug), `${q}: ${slug}`).toBe(true);
      for (const slug of INELIGIBLE) expect(r.slugs, `${q}: ${slug}`).not.toContain(slug);
    }
    expect((await projects("showAll=true&limit=100")).slugs.sort()).toEqual([...eligibleSlugs].sort());
  });

  it("signed out: every personal list is a 401", async () => {
    on();
    for (const q of ["", "showAll=false", "userId=anyone", "showFavorites=true", "showDeleted=true", "showAll=true&showFavorites=true", `username=${A.profile!.username}&showDeleted=true`]) {
      expect((await projects(q)).status, q || "(no params)").toBe(401);
    }
  });

  it("signed out: community counts are public, personal counts are a 401", async () => {
    on();
    const pub = await counts("");
    expect(pub.status).toBe(200);
    expect(pub.body.data).toEqual(eligible.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category]: (m[p.category] ?? 0) + 1 }), {}));
    for (const q of ["userId=anyone", "favorites=true", "deleted=true"]) expect((await counts(q)).status, q).toBe(401);
  });

  it("signed in: the personal variants are served again (not 401)", async () => {
    on();
    signInAs(A.subject!);
    expect((await projects("showFavorites=true")).status).toBe(200);
    expect((await projects("showDeleted=true")).status).toBe(200);
    expect((await counts("favorites=true")).status).toBe(200);
  });

  it("the tag list the public /tags page loads has active tags with listed counts only", async () => {
    on();
    const { getTags } = await import("../../src/app/actions/tags.js");
    const tags = await getTags();
    const nextjs = set.tags.find((t) => t.name === "Next.js")!.id;
    expect(tags.find((t) => t.name === "Next.js")?.count).toBe(eligible.filter((p) => p.tagIds.includes(nextjs)).length);
    expect(JSON.stringify(tags)).not.toMatch(/fixture-private|@synthetic/);
  });
});
