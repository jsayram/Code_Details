import { NextRequest } from "next/server";
import { executeQuery } from "@/db/server";
import { projects } from "@/db/schema/projects";
import { profiles } from "@/db/schema/profiles";
import { favorites } from "@/db/schema/favorites";
import { sql, isNull, isNotNull, eq, and, SQL } from "drizzle-orm";
import { success, databaseError } from "@/lib/api-errors";
import { routeViewer } from "@/lib/auth-server";
import { convexPersonalCounts, convexPublicCategoryCounts, personalReadsFromConvex } from "@/backend/projects/personal";

/**
 * GET /api/categories/counts
 * Returns the count of projects per category with optional filters
 * 
 * Query params:
 * - userId: present = a personal view (My Projects). Its value is ignored:
 *   the user is always the session's (D02r, P08 R08).
 * - favorites: If "true", count only the viewer's favorited projects
 * - deleted: If "true", count only the viewer's deleted projects
 *
 * No params = global community counts (non-deleted projects). Personal
 * counts need a signed-in viewer (empty otherwise) and are never cached
 * publicly.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const showFavorites = searchParams.get("favorites") === "true";
  const showDeleted = searchParams.get("deleted") === "true";
  const personal = searchParams.has("userId") || showFavorites || showDeleted;

  try {
    // D02r-c: behind the development switches, personal counts come from Convex.
    if (personal && personalReadsFromConvex()) {
      const response = success(await convexPersonalCounts(showDeleted ? "deleted" : showFavorites ? "favorites" : "mine"));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    // D07x: the community counts too, from listed projects only.
    if (!personal && personalReadsFromConvex()) {
      const response = success((await convexPublicCategoryCounts()) ?? {});
      response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return response;
    }

    const viewer = personal ? await routeViewer() : null;
    const userId = viewer?.userId ?? null;
    const categoryCounts = personal && !userId ? [] : await executeQuery(async (db) => {
      // Build where conditions based on filters
      const conditions: SQL<unknown>[] = [];

      if (showDeleted && userId) {
        // Deleted view: show only deleted projects for this user
        conditions.push(isNotNull(projects.deleted_at));
        conditions.push(eq(projects.user_id, userId));
      } else {
        // All other views: exclude deleted projects
        conditions.push(isNull(projects.deleted_at));
        
        if (userId && !showFavorites) {
          // My Projects view: filter by user
          conditions.push(eq(projects.user_id, userId));
        }
      }

      if (showFavorites && userId) {
        // Favorites view: join with favorites table
        // First get the profile_id for this user
        const profileResult = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.user_id, userId))
          .limit(1);

        if (profileResult.length === 0) {
          return [];
        }

        const profileId = profileResult[0].id;

        return await db
          .select({
            category: projects.category,
            count: sql<number>`count(*)::int`,
          })
          .from(projects)
          .innerJoin(favorites, eq(favorites.project_id, projects.id))
          .where(
            and(
              eq(favorites.profile_id, profileId),
              isNull(projects.deleted_at)
            )
          )
          .groupBy(projects.category);
      }

      // Standard query for community, my projects, or deleted views
      return await db
        .select({
          category: projects.category,
          count: sql<number>`count(*)::int`,
        })
        .from(projects)
        .where(and(...conditions))
        .groupBy(projects.category);
    });

    // Transform array to object for easier lookup
    const countsMap = categoryCounts.reduce(
      (acc, { category, count }) => {
        if (category) {
          acc[category] = count;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const response = success(countsMap);
    response.headers.set(
      "Cache-Control",
      personal ? "private, no-store" : "public, s-maxage=300, stale-while-revalidate=600"
    );
    
    return response;
  } catch (error) {
    console.error("[GET /api/categories/counts] Error:", error);
    return databaseError(error, "Failed to fetch category counts");
  }
}
