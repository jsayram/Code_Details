// Profile reads behind the public profile routes (D04a). Server-side only; not
// a "use server" module, so none of this is a callable action. Callers turn
// rows into the public projection (src/backend/profiles/public-profile.ts)
// before anything leaves the server.
import { executeQuery } from "@/db/server";
import { profiles, type SelectProfile } from "@/db/schema/profiles";
import { projects } from "@/db/schema/projects";
import { project_tags } from "@/db/schema/project_tags";
import { favorites } from "@/db/schema/favorites";
import { eq, sql, desc, and, isNull } from "drizzle-orm";

/**
 * A profile's public statistics (D04c, P08 R26). Deleted projects never count
 * (P07 §8: a deleted project isn't public). Every total comes from its own
 * query on the maintained counters, never from a join that repeats a project
 * row once per tag or favorite. The same fields on both backends; Convex
 * adds `capped` when a per-user range hit its bound.
 */
export interface ProfileStats {
  totalProjects: number;
  activeProjects: number;
  communityProjects: number;
  totalLikes: number;
  totalTags: number;
  projectsFavorited: number;
  projectsReceivedFavorites: number;
  joinedDate: Date | string | null;
  mostLikedProject: { title: string; favorites: number } | null;
  capped?: boolean;
}

export const emptyProfileStats = (joinedDate: Date | string | null): ProfileStats => ({
  totalProjects: 0,
  activeProjects: 0,
  communityProjects: 0,
  totalLikes: 0,
  totalTags: 0,
  projectsFavorited: 0,
  projectsReceivedFavorites: 0,
  joinedDate,
  mostLikedProject: null,
});

/** The statistics on the Supabase path. Falls back to zeros if a query fails, as before. */
export async function readProfileStats(profileData: SelectProfile): Promise<ProfileStats> {
  const userId = profileData.user_id;
  const active = and(eq(projects.user_id, userId), isNull(projects.deleted_at));
  try {
    return await executeQuery(async (db) => {
      // One row per active project: count and sum the counter column directly.
      const [own] = await db
        .select({
          count: sql<number>`count(*)`,
          likes: sql<number>`coalesce(sum(${projects.total_favorites}), 0)`,
        })
        .from(projects)
        .where(active);

      const [tagCount] = await db
        .select({ count: sql<number>`count(distinct ${project_tags.tag_id})` })
        .from(project_tags)
        .innerJoin(projects, eq(projects.id, project_tags.project_id))
        .where(active);

      // Projects this user favorited that are still there (profile.id, not user_id).
      const [given] = await db
        .select({
          all: sql<number>`count(distinct ${favorites.project_id})`,
          community: sql<number>`count(distinct case when ${projects.user_id} <> ${userId} then ${favorites.project_id} end)`,
        })
        .from(favorites)
        .innerJoin(projects, eq(projects.id, favorites.project_id))
        .where(and(eq(favorites.profile_id, profileData.id), isNull(projects.deleted_at)));

      const [mostLikedProject] = await db
        .select({ title: projects.title, favorites: projects.total_favorites })
        .from(projects)
        .where(active)
        .orderBy(desc(projects.total_favorites))
        .limit(1);

      const activeProjects = Number(own?.count || 0);
      const totalLikes = Number(own?.likes || 0);
      return {
        totalProjects: activeProjects,
        activeProjects,
        communityProjects: Number(given?.community || 0),
        totalLikes,
        totalTags: Number(tagCount?.count || 0),
        projectsFavorited: Number(given?.all || 0),
        projectsReceivedFavorites: totalLikes,
        joinedDate: profileData.created_at,
        mostLikedProject: mostLikedProject
          ? { title: mostLikedProject.title, favorites: Number(mostLikedProject.favorites || 0) }
          : null,
      };
    });
  } catch (statsError: unknown) {
    const errorMessage = statsError instanceof Error ? statsError.message : String(statsError);
    console.error("Error fetching stats:", errorMessage);
    return emptyProfileStats(profileData.created_at);
  }
}

export async function readProfileByUserId(userId: string): Promise<SelectProfile | null> {
  return executeQuery(async (db) => {
    const [row] = await db.select().from(profiles).where(eq(profiles.user_id, userId)).limit(1);
    return row ?? null;
  });
}

/** D04e: the tier of a user the caller already resolved from the session. */
export async function readTierByUserId(userId: string): Promise<string | null> {
  return executeQuery(async (db) => {
    const [row] = await db.select({ tier: profiles.tier }).from(profiles).where(eq(profiles.user_id, userId)).limit(1);
    return row?.tier ?? null;
  });
}
