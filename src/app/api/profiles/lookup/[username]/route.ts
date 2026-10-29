import { NextRequest } from "next/server";
import { executeQuery } from "@/db/server";
import { profiles } from "@/db/schema/profiles";
import { usernameHistory } from "@/db/schema/username-history";
import { eq, or, and } from "drizzle-orm";
import { notFound, serverError, success } from "@/lib/api-errors";
import { toPublicProfileRow } from "@/backend/profiles/public-profile";
import { convexPublicProfile, convexPublicStats } from "@/backend/profiles/read";
import { emptyProfileStats, readProfileStats } from "@/db/profile-read";

// D04a (P08 R07): the public projection only. The lookup no longer matches
// by email address (anyone could ask whether an address has an account and
// get its username back). `?includeStats=true` adds the profile page's
// statistics, which it used to fetch from /api/profiles/by-id with the
// owner's provider subject.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const username = decodeURIComponent(resolvedParams.username);
    const includeStats = request.nextUrl.searchParams.get("includeStats") === "true";

    const fromConvex = await convexPublicProfile(username);
    if (fromConvex !== undefined) {
      if (fromConvex?.kind === "redirect") {
        return success({
          redirect: true,
          oldUsername: username,
          currentUsername: fromConvex.currentUsername,
          profile: fromConvex.profile,
        });
      }
      if (fromConvex?.kind === "profile") {
        const { profile } = fromConvex;
        if (!includeStats) return success({ profile });
        // D04c: from the maintained project counters.
        const stats = (await convexPublicStats(username)) ?? emptyProfileStats(profile.created_at);
        return success({ profile, stats });
      }
      return notFound("profile", { identifier: username, identifierType: "username" });
    }

    // Single query with LEFT JOIN to find profile by:
    // 1. Direct username match
    // 2. Historical username match (via username_history)
    const result = await executeQuery(async (db) => {
      return await db
        .select({
          profile: profiles,
          historyOldUsername: usernameHistory.old_username,
        })
        .from(profiles)
        .leftJoin(
          usernameHistory,
          and(
            eq(usernameHistory.user_id, profiles.user_id),
            eq(usernameHistory.old_username, username)
          )
        )
        .where(
          or(
            eq(profiles.username, username),
            eq(usernameHistory.old_username, username)
          )
        )
        .limit(1);
    });

    if (!result.length) {
      return notFound("profile", { 
        identifier: username, 
        identifierType: "username" 
      });
    }

    const { profile: row, historyOldUsername } = result[0];
    const profile = toPublicProfileRow(row);

    // If we matched via history (old username), return redirect response
    if (historyOldUsername && row.username !== username) {
      return success({
        redirect: true,
        oldUsername: username,
        currentUsername: profile.username,
        profile,
      });
    }

    // Direct match - return profile
    if (!includeStats) return success({ profile });
    return success({ profile, stats: await readProfileStats(row) });
  } catch (error) {
    return serverError(error, "Failed to lookup profile");
  }
}
