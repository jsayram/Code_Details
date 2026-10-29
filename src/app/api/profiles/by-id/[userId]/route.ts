import { executeQuery } from "@/db/server";
import { profiles } from "@/db/schema/profiles";
import { eq } from "drizzle-orm";
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const resolvedParams = await Promise.resolve(params);
  const userId = resolvedParams.userId;
  const { username, profile_image_url } = await req.json();
  if (!userId || !username) {
    return invalidInput("Missing userId or username");
  }
  try {
    const updated = await executeQuery(async (db) => {
      const [result] = await db
        .update(profiles)
        .set({ username, profile_image_url, updated_at: new Date() })
        .where(eq(profiles.user_id, userId))
        .returning();
      return result;
    });
    if (!updated) {
      return notFound("profile", { identifier: userId, identifierType: "userId" });
    }
    return success({ profile: updated });
  } catch (error) {
    return databaseError(error, "Failed to update profile");
  }
}
