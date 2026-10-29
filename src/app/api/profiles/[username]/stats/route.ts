import { NextRequest } from "next/server";
import { executeQuery } from "@/db/server";
import { profiles } from "@/db/schema/profiles";
import { projects } from "@/db/schema/projects";
import { eq, sql, and, isNull } from "drizzle-orm";
import { success, notFound, databaseError } from "@/lib/api-errors";
import { toPublicProfileRow, usernameKey } from "@/backend/profiles/public-profile";
import { readProfileStats } from "@/db/profile-read";

// D04c (P08 R26): active projects only, totals from the counters without a
// join that repeats a project per tag, and the owner as the public
// projection (D04a, R07; a legacy email-shaped username shows its local part).
// The response keeps its earlier shape. Nothing in the app calls this route.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Properly resolve params as a Promise
    const resolvedParams = await Promise.resolve(params);
    const username = decodeURIComponent(resolvedParams.username);

    // First lookup the profile by username (case-insensitive)
    const profile = await executeQuery(async (db) => {
      return await db
        .select()
        .from(profiles)
        .where(eq(sql`lower(${profiles.username})`, usernameKey(username)))
        .limit(1);
    });

    if (!profile.length) {
      return notFound("profile", { identifier: username, identifierType: "username" });
    }

    const shared = await readProfileStats(profile[0]);
    // Own active projects with at least one favorite (this route's own meaning).
    const [withFavorites] = await executeQuery(async (db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(and(eq(projects.user_id, profile[0].user_id), isNull(projects.deleted_at), sql`${projects.total_favorites} > 0`))
    );
    const publicProfile = toPublicProfileRow(profile[0]);

    return success({
      stats: {
        totalProjects: shared.activeProjects,
        totalLikes: shared.totalLikes,
        totalTags: shared.totalTags,
        projectsFavorited: Number(withFavorites?.count || 0),
        mostLikedProject: shared.mostLikedProject,
        profile: {
          username: publicProfile.username,
          full_name: publicProfile.full_name,
          profile_image_url: publicProfile.profile_image_url,
        },
      },
    });
  } catch (error) {
    return databaseError(error, "Failed to fetch profile stats");
  }
}
