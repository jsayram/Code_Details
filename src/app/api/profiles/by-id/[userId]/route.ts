import { success, notFound, invalidInput, databaseError } from "@/lib/api-errors";
import { readProfileByUserId, readProfileStats } from "@/db/profile-read";
import { toPublicProfileRow } from "@/backend/profiles/public-profile";

// D04a (P08 R07): the public projection only, no email, tier, provider
// subject or profile UUID. The profile page reads its stats through
// /api/profiles/lookup now; this GET has no caller in the app.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  // Properly resolve params as a Promise
  const resolvedParams = await Promise.resolve(params);
  const userId = resolvedParams.userId;
  const url = new URL(req.url);
  const includeStats = url.searchParams.get("includeStats") === "true";

  if (!userId) {
    return invalidInput("Missing userId parameter");
  }

  try {
    const profileData = await readProfileByUserId(userId);
    if (!profileData) {
      return notFound("profile", { identifier: userId, identifierType: "userId" });
    }
    const profile = toPublicProfileRow(profileData);
    if (!includeStats) {
      return success({ profile });
    }
    return success({ profile, stats: await readProfileStats(profileData) });
  } catch (error) {
    return databaseError(error, "Failed to fetch profile");
  }
}

// POST was removed (D04b, P08 R05): it let any caller rename any user and swap
// their avatar, with no history row. Nothing in the app called it; profile
// edits go through PUT /api/profiles/[username], which checks the session.
