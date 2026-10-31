import { NextRequest } from "next/server";
import { success, databaseError, serverError, unauthorized } from "@/lib/api-errors";
import { betterAuthSignedIn } from "@/lib/auth-server";
import { DATA_UNAVAILABLE, convexPersonalCounts, convexPublicCategoryCounts, personalReadsFromConvex } from "@/backend/projects/personal";

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

  // D09 S02c: a public route now; personal counts need a live session.
  if (personal && (await betterAuthSignedIn()) !== true) return unauthorized("Sign in to see your own counts");

  // E03: Convex only; the Supabase counts are gone.
  if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);

  try {
    // D02r-c: personal counts come from Convex, read as the session.
    if (personal) {
      const response = success(await convexPersonalCounts(showDeleted ? "deleted" : showFavorites ? "favorites" : "mine"));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    // D07x: the community counts too, from listed projects only.
    const response = success((await convexPublicCategoryCounts()) ?? {});
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response;
  } catch (error) {
    console.error("[GET /api/categories/counts] Error:", error);
    return databaseError(error, "Failed to fetch category counts");
  }
}
