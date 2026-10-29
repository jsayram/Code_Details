// Profile reads behind the public profile routes (D04a). Server-side only; not
// a "use server" module, so none of this is a callable action. Callers turn
// rows into the public projection (src/backend/profiles/public-profile.ts)
// before anything leaves the server.
import { executeQuery } from "@/db/server";
import { profiles, type SelectProfile } from "@/db/schema/profiles";
import { projects } from "@/db/schema/projects";
import { project_tags } from "@/db/schema/project_tags";
import { favorites } from "@/db/schema/favorites";
import { eq, sql, desc, and, isNull, ne } from "drizzle-orm";

export interface ProfileStats {
  totalProjects: number;
  activeProjects: number;
  graveyardProjects: number;
  communityProjects: number;
  totalLikes: number;
  totalTags: number;
  projectsFavorited: number;
  projectsReceivedFavorites: number;
  joinedDate: Date | null;
  mostLikedProject: { title: string; favorites: number } | null;
}

export const emptyProfileStats = (joinedDate: Date | null): ProfileStats => ({
  totalProjects: 0,
  activeProjects: 0,
  graveyardProjects: 0,
  communityProjects: 0,
  totalLikes: 0,
  totalTags: 0,
  projectsFavorited: 0,
  projectsReceivedFavorites: 0,
  joinedDate,
  mostLikedProject: null,
});

/**
 * The profile page's statistics, unchanged from GET /api/profiles/by-id
 * (moved here so the username lookup can serve them). D04c replaces them with
 * maintained counters. Falls back to zeros if a stats query fails, as before.
 */
export async function readProfileStats(profileData: SelectProfile): Promise<ProfileStats> {
  const userId = profileData.user_id;
  try {
    return await executeQuery(async (db) => {
      const [statsResult] = await db
        .select({
          totalProjects: sql<number>`count(distinct ${projects.id})`,
          activeProjects: sql<number>`count(distinct case when ${projects.deleted_at} is null then ${projects.id} end)`,
          graveyardProjects: sql<number>`count(distinct case when ${projects.deleted_at} is not null then ${projects.id} end)`,
          totalLikes: sql<number>`coalesce(sum(${projects.total_favorites}), 0)`,
          totalTags: sql<number>`count(distinct ${project_tags.tag_id})`,
        })
        .from(projects)
        .leftJoin(project_tags, eq(project_tags.project_id, projects.id))
        .where(eq(projects.user_id, userId));

      // Favorites given by this user (using profile.id not user_id)
      const [favoritesGiven] = await db
        .select({
          projectsFavorited: sql<number>`count(distinct ${favorites.project_id})`,
        })
        .from(favorites)
        .where(eq(favorites.profile_id, profileData.id));

      // Favorites received on the user's projects
      const [favoritesReceived] = await db
        .select({
          projectsReceivedFavorites: sql<number>`count(*)`,
        })
        .from(favorites)
        .innerJoin(projects, eq(projects.id, favorites.project_id))
        .where(eq(projects.user_id, userId));

      // Community projects (favorited projects from other users)
      const [communityStats] = await db
        .select({
          communityProjects: sql<number>`count(distinct ${projects.id})`,
        })
        .from(favorites)
        .innerJoin(projects, eq(projects.id, favorites.project_id))
        .where(
          and(
            eq(favorites.profile_id, profileData.id),
            ne(projects.user_id, userId),
            isNull(projects.deleted_at)
          )
        );

      const [mostLikedProject] = await db
        .select({
          title: projects.title,
          favorites: projects.total_favorites,
        })
        .from(projects)
        .where(and(eq(projects.user_id, userId), isNull(projects.deleted_at)))
        .orderBy(desc(projects.total_favorites))
        .limit(1);

      return {
        totalProjects: Number(statsResult?.totalProjects || 0),
        activeProjects: Number(statsResult?.activeProjects || 0),
        graveyardProjects: Number(statsResult?.graveyardProjects || 0),
        communityProjects: Number(communityStats?.communityProjects || 0),
        totalLikes: Number(statsResult?.totalLikes || 0),
        totalTags: Number(statsResult?.totalTags || 0),
        projectsFavorited: Number(favoritesGiven?.projectsFavorited || 0),
        projectsReceivedFavorites: Number(favoritesReceived?.projectsReceivedFavorites || 0),
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
