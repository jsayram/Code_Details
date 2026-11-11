import { NextRequest } from "next/server";
import { notFound, serverError, success } from "@/lib/api-errors";
import { convexPublicProfile, convexPublicStats } from "@/backend/profiles/read";
import { emptyProfileStats } from "@/backend/profiles/read";
import { DATA_UNAVAILABLE } from "@/backend/projects/personal";

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

    // E03: Convex only; the Supabase lookup is gone.
    const fromConvex = await convexPublicProfile(username);
    if (fromConvex === undefined) return serverError(undefined, DATA_UNAVAILABLE);
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
  } catch (error) {
    return serverError(error, "Failed to lookup profile");
  }
}
