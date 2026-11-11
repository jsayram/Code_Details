import { NextRequest } from "next/server";
import { success, notFound, serverError } from "@/lib/api-errors";
import { DATA_UNAVAILABLE, convexPublicCategoryCounts, personalReadsFromConvex } from "@/backend/projects/personal";

/**
 * GET /api/shared-projects/[username]/categories
 * Returns the count of non-deleted projects per category for a specific user
 * Used by SharedProjectsGrid to show which categories the user has projects in
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  const params = await context.params;
  const username = params.username.toLowerCase();

  try {
    // D07x: from Convex: listed projects of an active account only (a
    // deleting account's portfolio is not public). E03: no Supabase fallback.
    if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);
    const counts = await convexPublicCategoryCounts(username);
    if (!counts) return notFound("user", { identifier: username });
    const response = success(counts);
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response;
  } catch (error) {
    console.error("[GET /api/shared-projects/[username]/categories] Error:", error);
    return serverError(error, "Failed to fetch user category counts");
  }
}
