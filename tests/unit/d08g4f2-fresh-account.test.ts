// DEF-FLIP-FRESHACCT (D08g4f2): under the Convex data default the dashboard and
// the share link come from the session's Convex account, so an account with no
// Clerk-era subject (legacySubject null) gets them. The Supabase-only
// routeViewer path isn't consulted.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalProjectCard } from "@/backend/projects/personal";

const session = vi.hoisted(() => ({
  signedIn: true,
  username: "user-abc123" as string | null,
  mine: [] as unknown[],
  favorites: [] as unknown[],
  routeViewerCalls: 0,
}));
vi.mock("@/lib/auth-server", () => ({
  betterAuthSignedIn: async () => session.signedIn,
  viewerQuery: async (ref: unknown) => {
    const name = (ref as { [k: symbol]: string })[Symbol.for("functionName")] ?? String(ref);
    if (/whoami/.test(name)) return { result: session.signedIn ? { username: session.username } : null };
    if (/listMine/.test(name)) return { result: session.signedIn ? session.mine : [] };
    return { result: session.signedIn ? session.favorites : [] };
  },
  routeViewer: async () => {
    session.routeViewerCalls++;
    return null; // a fresh account has no Clerk-era subject
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidateTag: vi.fn() }));

import { dashboardFromCards } from "@/backend/projects/dashboard";
import { fetchUserDashboardData } from "@/app/actions/user-dashboard";
import { getMyShareUsername } from "@/app/actions/share";

const convexDefault = { NODE_ENV: "development", CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210", CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211" };
const NOW = Date.parse("2026-10-30T12:00:00Z");
const card = (over: Partial<PersonalProjectCard>): PersonalProjectCard => ({
  id: "p1",
  slug: "p1",
  title: "P1",
  description: null,
  category: "web",
  visibility: "public",
  tags: [],
  favoriteCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
  owner: { username: "user-abc123", fullName: null, avatarUrl: null },
  isMine: true,
  isFavorite: false,
  ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(session, { signedIn: true, username: "user-abc123", mine: [], favorites: [], routeViewerCalls: 0 });
});

describe("dashboardFromCards", () => {
  it("an empty account gets an empty dashboard, not an error", () => {
    const stats = dashboardFromCards([], [], NOW);
    expect(stats).toMatchObject({ totalProjects: 0, totalFavorites: 0, totalFavoritesGiven: 0, myProjects: [], myFavorites: [], topTags: [] });
    expect(stats.projectStats).toEqual({ totalTags: 0, activeThisWeek: 0, mostPopularProject: null });
  });

  it("counts, tags, activity and favorites from the viewer's own cards", () => {
    const mine = [
      card({ id: "a", title: "A", tags: ["x", "y"], favoriteCount: 3, updatedAt: "2026-10-29T00:00:00Z" }),
      card({ id: "b", title: "B", tags: ["x"], favoriteCount: 1, createdAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z" }),
      card({ id: "gone", tags: ["z"], favoriteCount: 9, deletedAt: "2026-10-20T00:00:00Z" }),
    ];
    const favorites = [card({ id: "f", title: "F", isMine: false, owner: { username: "someone", fullName: null, avatarUrl: null } })];
    const stats = dashboardFromCards(mine, favorites, NOW);
    expect(stats.totalProjects).toBe(2);
    expect(stats.totalFavorites).toBe(4);
    expect(stats.totalFavoritesGiven).toBe(1);
    expect(stats.projectStats).toEqual({ totalTags: 2, activeThisWeek: 2, mostPopularProject: { id: "a", title: "A", favorites: 3 } });
    expect(stats.recentActivity.map((r) => [r.id, r.action])).toEqual([["a", "updated"], ["b", "created"]]);
    expect(stats.topTags.map((t) => [t.name, t.count])).toEqual([["x", 2], ["y", 1]]);
    expect(stats.allTags).toEqual([{ name: "x" }, { name: "y" }]);
    expect(stats.myFavorites).toEqual([expect.objectContaining({ id: "f", owner_username: "someone", owner_user_id: null })]);
    expect(stats.projectsWithFavorites.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("the actions under the Convex default", () => {
  it("the dashboard loads for an account with no Clerk-era subject", async () => {
    for (const [k, v] of Object.entries(convexDefault)) vi.stubEnv(k, v);
    session.mine = [card({ id: "a" })];
    const { stats } = await fetchUserDashboardData();
    expect(stats.totalProjects).toBe(1);
    expect(session.routeViewerCalls).toBe(0);
  });

  it("signed out still fails closed", async () => {
    for (const [k, v] of Object.entries(convexDefault)) vi.stubEnv(k, v);
    session.signedIn = false;
    await expect(fetchUserDashboardData()).rejects.toThrow("Unauthorized");
  });

  it("the share link uses the Convex account's own handle", async () => {
    for (const [k, v] of Object.entries(convexDefault)) vi.stubEnv(k, v);
    expect(await getMyShareUsername()).toBe("user-abc123");
    session.signedIn = false;
    expect(await getMyShareUsername()).toBeNull();
    expect(session.routeViewerCalls).toBe(0);
  });
});
