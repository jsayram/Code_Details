// D04c: profiles:getPublicStats and profiles:listPublic on the task-owned
// test backend, read anonymously. Numbers come from the listed projects'
// maintained counters; deleted and private projects, favorites on them and
// deleting accounts never count.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_PROFILE_KEYS } from "@/backend/profiles/public-profile";
import { convexImportUsername, generateFixtures, type PersonaKey } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { expectedProfileStats } from "../support/profile-stats-spec";

const set = generateFixtures();
const getPublicStats = makeFunctionReference<"query", { handle: string }, Record<string, unknown> | null>("profiles:getPublicStats");
const listPublic = makeFunctionReference<"query", Record<string, never>, { rows: Record<string, unknown>[]; capped: boolean }>("profiles:listPublic");
const anon = anonymousClient();
const handleOf = (key: PersonaKey) => convexImportUsername(set.personas[key].subject!, set.personas[key].profile!.username);
const favs = (projectId: string) => set.favorites.filter((f) => f.projectId === projectId).length;

describe.skipIf(!convexAvailable())("D04c Convex profile stats", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it.each<PersonaKey>(["a", "b", "emailUsername", "renamed"])("persona %s: every number matches the fixture spec (listed projects only)", async (key) => {
    const stats = (await anon.query(getPublicStats, { handle: handleOf(key) }))!;
    const { mostLikedFavorites, ...numbers } = expectedProfileStats(set, key, false);
    expect(stats).toMatchObject({ ...numbers, capped: false });
    expect((stats.mostLikedProject as { favorites: number } | null)?.favorites ?? null).toBe(mostLikedFavorites);
    expect(stats).not.toHaveProperty("graveyardProjects");
  });

  it("A's private and deleted projects don't count, though they exist", () => {
    const a = set.projects.filter((p) => p.ownerKey === "a" && !p.purged);
    expect(a.some((p) => p.visibility === "private")).toBe(true);
    expect(a.some((p) => p.deletedAt)).toBe(true);
    expect(expectedProfileStats(set, "a", false).activeProjects).toBeLessThan(expectedProfileStats(set, "a", true).activeProjects);
  });

  it("hides a deleting account and a missing name", async () => {
    expect(await anon.query(getPublicStats, { handle: "fixture-leaving" })).toBeNull();
    expect(await anon.query(getPublicStats, { handle: "fixture-nobody" })).toBeNull();
  });

  describe("listPublic", () => {
    it("lists public profiles with listed-project counts, newest first, nothing private", async () => {
      const { rows, capped } = await anon.query(listPublic, {});
      expect(capped).toBe(false);
      const usernames = rows.map((r) => r.username);
      expect(usernames).not.toContain("fixture-leaving");
      expect(usernames).toContain(handleOf("emailUsername"));
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([...PUBLIC_PROFILE_KEYS, "lastActivity", "projectCount", "totalFavorites"].sort());
      }
      const alice = rows.find((r) => r.username === "fixture-alice")!;
      const listedA = set.projects.filter((p) => p.ownerKey === "a" && !p.purged && !p.deletedAt && p.visibility === "public");
      expect(alice.projectCount).toBe(listedA.length);
      expect(alice.totalFavorites).toBe(listedA.reduce((n, p) => n + favs(p.id), 0));
      const text = JSON.stringify(rows);
      expect(text).not.toContain("@");
      expect(text).not.toMatch(/user_fixture_|"tier"|"role"|"userId"/);
      const created = rows.map((r) => String(r.createdAt));
      expect(created).toEqual([...created].sort().reverse());
    });
  });
});
