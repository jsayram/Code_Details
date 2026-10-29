// D04c (P08 R26): profile statistics on the default Supabase path. Totals
// come from the projects' counters, not from a join that repeats a project per
// tag; deleted projects and favorites on deleted projects never count.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures, type PersonaKey } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { expectedProfileStats } from "../support/profile-stats-spec";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const { a: A, b: B, emailUsername: legacy } = set.personas;
const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3100"));

describe.skipIf(!testDbAvailable())("D04c profile stats (Supabase)", () => {
  let sql: postgres.Sql;

  const statsOf = async (name: string) => {
    const route = await import("../../src/app/api/profiles/lookup/[username]/route.js");
    const res = await route.GET(req(`/api/profiles/lookup/${encodeURIComponent(name)}?includeStats=true`), { params: Promise.resolve({ username: encodeURIComponent(name) }) });
    return JSON.parse(await res.text()).data.stats;
  };

  beforeAll(async () => {
    sql = await connectTestDb();
  });
  beforeEach(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  it("the fixture really has the shapes R26 is about", () => {
    const listed = set.projects.find((p) => p.case === "listed")!;
    expect(listed.tagIds.length).toBeGreaterThan(1);
    expect(set.favorites.filter((f) => f.projectId === listed.id).length).toBeGreaterThan(0);
    expect(set.favorites.some((f) => set.projects.find((p) => p.id === f.projectId)!.deletedAt)).toBe(true);
  });

  it.each<PersonaKey>(["a", "b", "emailUsername", "renamed"])("persona %s: every number matches the fixture spec", async (key) => {
    const persona = set.personas[key];
    const stats = await statsOf(persona.profile!.username);
    const want = expectedProfileStats(set, key, true);
    const { mostLikedFavorites, ...numbers } = want;
    expect(stats).toMatchObject(numbers);
    expect(stats.mostLikedProject?.favorites ?? null).toBe(mostLikedFavorites);
    expect(stats).not.toHaveProperty("graveyardProjects");
  });

  it("a project's favorites count once however many tags it has", async () => {
    // Give A's listed project more tags; the likes total must not move.
    const before = await statsOf(A.profile!.username);
    const listed = set.projects.find((p) => p.case === "listed")!;
    const extra = await sql`select id from tags where id <> all(${listed.tagIds}::uuid[]) limit 3`;
    expect(extra.length).toBeGreaterThan(0);
    for (const t of extra) await sql`insert into project_tags (project_id, tag_id) values (${listed.id}, ${t.id}) on conflict do nothing`;
    const after = await statsOf(A.profile!.username);
    expect(after.totalLikes).toBe(before.totalLikes);
    expect(after.projectsReceivedFavorites).toBe(before.projectsReceivedFavorites);
    expect(after.activeProjects).toBe(before.activeProjects);
  });

  it("a deleted project leaves every total", async () => {
    const before = await statsOf(B.profile!.username);
    const bob = set.projects.find((p) => p.case === "ownedByB")!;
    await sql`update projects set deleted_at = now() where id = ${bob.id}`;
    const after = await statsOf(B.profile!.username);
    expect(after.activeProjects).toBe(before.activeProjects - 1);
    expect(after.totalLikes).toBe(before.totalLikes - set.favorites.filter((f) => f.projectId === bob.id).length);
    // A favorited Bob's project; it no longer counts for A either.
    const a = await statsOf(A.profile!.username);
    expect(a.projectsFavorited).toBe(expectedProfileStats(set, "a", true).projectsFavorited - 1);
    expect(a.communityProjects).toBe(expectedProfileStats(set, "a", true).communityProjects - 1);
  });

  describe("GET /api/profiles/[username]/stats", () => {
    const stats = async (name: string) => {
      const route = await import("../../src/app/api/profiles/[username]/stats/route.js");
      return route.GET(req(`/api/profiles/${encodeURIComponent(name)}/stats`), { params: Promise.resolve({ username: encodeURIComponent(name) }) });
    };

    it("uses the same rules and keeps its shape", async () => {
      const res = await stats("FIXTURE-ALICE");
      const data = JSON.parse(await res.text()).data.stats;
      const want = expectedProfileStats(set, "a", true);
      expect(data).toMatchObject({ totalProjects: want.activeProjects, totalLikes: want.totalLikes, totalTags: want.totalTags });
      expect(Object.keys(data).sort()).toEqual(["mostLikedProject", "profile", "projectsFavorited", "totalLikes", "totalProjects", "totalTags"]);
    });

    it("never returns a legacy email-shaped username", async () => {
      const res = await stats(legacy.profile!.username);
      const text = await res.text();
      expect(JSON.parse(text).data.stats.profile.username).toBe("fixture.legacy");
      expect(text).not.toContain("@synthetic.invalid");
    });
  });
});
