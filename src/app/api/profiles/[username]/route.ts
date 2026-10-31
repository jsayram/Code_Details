import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { 
  notFound, 
  unauthorized, 
  validationError, 
  serverError,
  success,
  conflict,
} from "@/lib/api-errors";
import { updateProfileSchema, formatZodErrors } from "@/types/schemas/profile";
import { updateProfileOnConvex } from "@/backend/profiles/profile-update";
import { DATA_UNAVAILABLE, personalReadsFromConvex } from "@/backend/projects/personal";
import { convexPublicProfile } from "@/backend/profiles/read";

// D04a (P08 R07): the public projection only (no email, tier, provider
// subject or profile UUID), from Convex. E03: the Supabase read is gone.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;

    const fromConvex = await convexPublicProfile(username);
    if (fromConvex === undefined) return serverError(undefined, DATA_UNAVAILABLE);
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
  } catch (error) {
    console.error("Error fetching profile:", error);
    return serverError(error, "Failed to fetch profile");
  }
}

// D04b (P08 R22): the owner edits their own profile through the Convex
// profiles:updateMine mutation, which learns the caller from the Better Auth
// session and applies the shared username rules and the history row. E03: the
// Supabase edit is gone.
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;

    // 1. Parse and validate request body
    const body = await request.json().catch(() => null);
    const validation = updateProfileSchema.safeParse(body);
    if (!validation.success) {
      return validationError(
        formatZodErrors(validation.error),
        "Invalid profile data provided"
      );
    }
    const validatedData = validation.data;

    // D04e (P08 R23): the email address changes only through the auth
    // provider, verified. The app never takes it from a form.
    if (validatedData.email_address !== undefined) {
      const message = "Change your email address in your account settings";
      return validationError([{ field: "email_address", message }], message);
    }

    // 2. With no local Convex there is nothing to edit (fail closed).
    if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);

    const result = await updateProfileOnConvex(username, validatedData);
    if (result.ok) {
      revalidateTag(CACHE_TAGS.USER_PROFILE, {});
      return success({ profile: result.profile });
    }
    if (result.code === "not_signed_in") return unauthorized("You must be signed in to update a profile");
    if (result.code === "not_found") return notFound("profile", { identifier: username, identifierType: "username" });
    if (result.code === "taken") return conflict("profile", "username");
    return validationError([{ field: result.field, message: result.message }], result.message);
  } catch (error) {
    console.error("Error updating profile:");
    return serverError(error, "Failed to update profile");
  }
}
