import { NextRequest } from "next/server";
import { executeQuery } from "@/db/server";
import { profiles } from "@/db/schema/profiles";
import { usernameHistory } from "@/db/schema/username-history";
import { eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { 
  notFound, 
  unauthorized, 
  notOwner,
  validationError, 
  serverError,
  success,
  conflict,
} from "@/lib/api-errors";
import { updateProfileSchema, formatZodErrors } from "@/types/schemas/profile";
import { toPublicProfileRow, usernameKey } from "@/backend/profiles/public-profile";
import { updateProfileOnConvex } from "@/backend/profiles/profile-update";
import { projectWritesToConvex } from "@/backend/projects/project-update";
import { updateProfileRow } from "@/db/profile-write";
import { routeViewer } from "@/lib/auth-server";
import { convexPublicProfile } from "@/backend/profiles/read";

// D04a (P08 R07): the public projection only (no email, tier, provider
// subject or profile UUID), from Convex under the read switch.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;

    const fromConvex = await convexPublicProfile(username);
    if (fromConvex !== undefined) {
      if (fromConvex?.kind === "profile") return success({ profile: fromConvex.profile });
      if (fromConvex?.kind === "redirect") {
        return success({
          redirect: true,
          oldUsername: username,
          currentUsername: fromConvex.currentUsername,
          profile: fromConvex.profile,
        });
      }
      return notFound("profile", { identifier: username, identifierType: "username" });
    }
    
    const profile = await executeQuery(async (db) => {
      const result = await db
        .select()
        .from(profiles)
        .where(eq(profiles.username, username))
        .limit(1);

      return result[0] || null;
    });

    if (!profile) {
      // Profile not found - check if this is a historical username
      const historyRecord = await executeQuery(async (db) => {
        return await db
          .select()
          .from(usernameHistory)
          .where(eq(usernameHistory.old_username, username))
          .limit(1);
      });

      if (historyRecord.length) {
        // Found in history - look up current username by user_id
        const currentProfile = await executeQuery(async (db) => {
          return await db
            .select()
            .from(profiles)
            .where(eq(profiles.user_id, historyRecord[0].user_id))
            .limit(1);
        });

        if (currentProfile.length) {
          const current = toPublicProfileRow(currentProfile[0]);
          // Return redirect info with current profile
          return success({
            redirect: true,
            oldUsername: username,
            currentUsername: current.username,
            profile: current,
          });
        }
      }

      // No profile found and no history - return 404
      return notFound("profile", { 
        identifier: username, 
        identifierType: "username" 
      });
    }

    return success({ profile: toPublicProfileRow(profile) });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return serverError(error, "Failed to fetch profile");
  }
}

// D04b (P08 R22): the owner edits their own profile. Identity comes from the
// session (routeViewer), never from Clerk directly. A rename follows the
// shared username rules and writes the history row in the same transaction
// (src/db/profile-write.ts); under both development switches the edit goes to
// the Convex profiles:updateMine mutation instead.
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;

    // 1. Authentication check. Under both switches the mutation learns the
    // caller from the Better Auth session itself (a new account has no
    // Clerk-era subject, so routeViewer would say signed out).
    const toConvex = projectWritesToConvex();
    const viewer = toConvex ? null : await routeViewer();
    if (!toConvex && !viewer) {
      return unauthorized("You must be signed in to update a profile");
    }

    // 2. Parse and validate request body
    const body = await request.json().catch(() => null);
    const validation = updateProfileSchema.safeParse(body);
    if (!validation.success) {
      return validationError(
        formatZodErrors(validation.error),
        "Invalid profile data provided"
      );
    }
    const validatedData = validation.data;

    if (toConvex) {
      const result = await updateProfileOnConvex(username, validatedData);
      if (result.ok) {
        revalidateTag(CACHE_TAGS.USER_PROFILE, {});
        return success({ profile: result.profile });
      }
      if (result.code === "not_signed_in") return unauthorized("You must be signed in to update a profile");
      if (result.code === "not_found") return notFound("profile", { identifier: username, identifierType: "username" });
      if (result.code === "taken") return conflict("profile", "username");
      return validationError([{ field: result.field, message: result.message }], result.message);
    }

    if (!viewer) return unauthorized("You must be signed in to update a profile");

    // 3. Check the profile exists (case-insensitive) and the user owns it
    const existingProfile = await executeQuery(async (db) => {
      const result = await db
        .select()
        .from(profiles)
        .where(eq(sql`lower(${profiles.username})`, usernameKey(username)))
        .limit(1);
      return result[0] || null;
    });

    if (!existingProfile) {
      return notFound("profile", { 
        identifier: username, 
        identifierType: "username" 
      });
    }

    if (existingProfile.user_id !== viewer.userId) {
      return notOwner("profile", {
        resource: "profile",
        identifier: username,
        operation: "PUT",
      });
    }

    // 4. Update the profile (the columns that exist; first/last name and bio
    // have no column and were never stored)
    const result = await updateProfileRow({ userId: viewer.userId }, {
      ...(validatedData.username !== undefined && { username: validatedData.username }),
      ...(validatedData.email_address && { email_address: validatedData.email_address }),
      ...(validatedData.profile_image_url !== undefined && { profile_image_url: validatedData.profile_image_url }),
      ...(validatedData.full_name !== undefined && { full_name: validatedData.full_name }),
    });
    if (!result.ok) {
      if (result.code === "not_found") return notFound("profile", { identifier: username, identifierType: "username" });
      if (result.code === "taken") return conflict("profile", "username");
      return validationError([{ field: "username", message: result.message }], result.message);
    }

    // Invalidate user profile cache after update
    revalidateTag(CACHE_TAGS.USER_PROFILE, {});

    return success({ profile: toPublicProfileRow(result.profile) });
  } catch (error) {
    console.error("Error updating profile:");
    return serverError(error, "Failed to update profile");
  }
}
