// DEF-D07X-MULTITAG: on the default Supabase path, /api/projects with two or
// more tag filters that both match a tag returned a 500: the tag subquery
// joined the IDs with no separator (`IN ($1$2)`). Both branches that build it
// (the community list and favorites) must answer with the projects carrying
// every tag.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const { a: A } = set.personas;
const tagId = (name: string) => set.tags.find((t) => t.name === name)!.id;
const carrying = (names: string[], extra: (p: (typeof set.projects)[number]) => boolean = () => true) =>
  set.projects
    .filter((p) => !p.purged && !p.deletedAt && names.every((n) => p.tagIds.includes(tagId(n))) && extra(p))
    .map((p) => p.slug)
    .sort();

describe.skipIf(!testDbAvailable())("DEF-D07X-MULTITAG: several tag filters on the Supabase route", () => {
  let sql: postgres.Sql;
  let route: typeof import("../../src/app/api/projects/route.js");

  beforeAll(async () => {
    sql = await connectTestDb();
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
    route = await import("../../src/app/api/projects/route.js");
  });
  afterAll(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await sql.end();
  });

  const get = async (query: string) => {
    const res = await route.GET(new NextRequest(`http://localhost:3100/api/projects?limit=50&${query}`));
    return { status: res.status, body: JSON.parse(await res.text()) as { data?: { slug: string }[]; pagination?: { total: number } } };
  };

  it("the community list returns the projects carrying every tag", async () => {
    signInAs(A.subject);
    const { status, body } = await get("showAll=true&tags=Next.js&tags=Postgres");
    expect(status).toBe(200);
    const expected = carrying(["Next.js", "Postgres"]);
    expect(expected).toContain("fixture-listed");
    expect(body.data!.map((r) => r.slug).sort()).toEqual(expected);
    expect(Number(body.pagination!.total)).toBe(expected.length);
  });

  it("favorites filter by every tag too", async () => {
    signInAs(A.subject);
    const { status, body } = await get("showAll=true&showFavorites=true&tags=Next.js&tags=Postgres");
    expect(status).toBe(200);
    expect(body.data!.map((r) => r.slug)).toEqual(["fixture-listed"]);
  });

  it("three tags, one of them unknown, still works (unknown names are ignored, as before)", async () => {
    signInAs(A.subject);
    const { status, body } = await get("showAll=true&tags=Next.js&tags=Postgres&tags=No%20Such%20Tag");
    expect(status).toBe(200);
    expect(body.data!.map((r) => r.slug).sort()).toEqual(carrying(["Next.js", "Postgres"]));
  });
});
