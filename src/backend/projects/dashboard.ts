// DEF-FLIP-FRESHACCT (D08g4f2): the user dashboard's stats under the Convex
// data default, built from the session's own Convex lists (projects:listMine
// and the favorites list), so an account with no Clerk-era subject gets its
// dashboard. The viewer comes only from the session (viewerQuery). Same shape
// as the Supabase getUserDashboardStats; what Convex has no read for yet is
// empty: the viewer's tag suggestions across projects and who favorited their
// projects (recentAppreciation). Server-side only.
import type { UserDashboardStats } from "@/db/operations/userDashboardOperations";
import { betterAuthSignedIn } from "@/lib/auth-server";
import { convexPersonalList, type PersonalProjectCard } from "./personal";

const DAY = 24 * 60 * 60 * 1000;
const time = (iso: string) => new Date(iso).getTime();

/** The dashboard from the viewer's own active projects and favorites. Pure, for tests. */
export function dashboardFromCards(mine: PersonalProjectCard[], favorites: PersonalProjectCard[], now = Date.now()): UserDashboardStats {
  const active = mine.filter((c) => !c.deletedAt);
  const byUpdated = [...active].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  const popular = [...active].sort((a, b) => b.favoriteCount - a.favoriteCount)[0];
  const tagCounts = new Map<string, PersonalProjectCard[]>();
  for (const card of byUpdated) for (const tag of card.tags) tagCounts.set(tag, [...(tagCounts.get(tag) ?? []), card]);
  const ref = (c: PersonalProjectCard) => ({ id: c.id, slug: c.slug, title: c.title });
  return {
    totalProjects: active.length,
    totalFavorites: active.reduce((sum, c) => sum + c.favoriteCount, 0),
    totalFavoritesGiven: favorites.length,
    projectStats: {
      totalTags: tagCounts.size,
      activeThisWeek: active.filter((c) => now - time(c.updatedAt) < 7 * DAY).length,
      mostPopularProject: popular ? { id: popular.id, title: popular.title, favorites: popular.favoriteCount } : null,
    },
    recentActivity: byUpdated
      .filter((c) => now - time(c.updatedAt) < 60 * DAY)
      .slice(0, 10)
      .map((c) => ({ ...ref(c), action: c.createdAt === c.updatedAt ? "created" : "updated", timestamp: new Date(c.updatedAt) })),
    myProjects: byUpdated.map((c) => ({
      ...ref(c),
      description: c.description,
      total_favorites: c.favoriteCount,
      category: c.category,
      created_at: new Date(c.createdAt),
      tags: c.tags,
    })),
    myFavorites: favorites.map((c) => ({
      ...ref(c),
      owner_username: c.owner?.username ?? null,
      // Never another account's ID: the dashboard only links by handle.
      owner_user_id: null,
      category: c.category,
      favorited_at: null,
      deleted_at: c.deletedAt ? new Date(c.deletedAt) : null,
      tags: c.tags,
    })),
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, cards]) => ({ name, count: cards.length, projects: cards.map(ref) })),
    allTags: [...tagCounts.keys()].sort().map((name) => ({ name })),
    projectsWithFavorites: active
      .filter((c) => c.favoriteCount > 0)
      .sort((a, b) => b.favoriteCount - a.favoriteCount)
      .map((c) => ({ ...ref(c), total_favorites: c.favoriteCount })),
    myTagSubmissions: [],
    recentAppreciation: [],
  };
}

/** The session's dashboard from Convex; null when nobody is signed in. */
export async function convexDashboardStats(): Promise<UserDashboardStats | null> {
  if (!(await betterAuthSignedIn())) return null;
  const [mine, favorites] = await Promise.all([convexPersonalList("mine"), convexPersonalList("favorites")]);
  return dashboardFromCards(mine, favorites);
}
