/**
 * Client-side user sync endpoint
 * Called by the app when a user signs in to ensure they exist in the database
 * This is a fallback for when webhooks aren't available (local dev without ngrok)
 * Uses shared user sync utilities to avoid duplication with webhook logic
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { createOrUpdateUserProfile } from "@/lib/user-sync-utils";
import { ClerkUserData } from "@/types/models/clerkUserData";
import { unauthorized, serverError, success } from "@/lib/api-errors";
import { CACHE_TAGS } from "@/lib/swr-fetchers";

export async function POST() {
  try {
    // Identity comes only from the Clerk session (D01, R06). The proxy forwards
    // the visitor's cookies; a userId in the body is never read.
    const { userId } = await auth();
    if (!userId) {
      return unauthorized();
    }

    const user = await currentUser();
    if (!user) {
      return serverError("Could not fetch user data from Clerk");
    }

    console.log(`🔄 Syncing user ${userId} to database (client-side sync)`);

    // Convert Clerk's currentUser() format to ClerkUserData format
    const clerkUserData: ClerkUserData = {
      id: user.id,
      first_name: user.firstName || undefined,
      last_name: user.lastName || undefined,
      email_addresses: user.emailAddresses.map((email) => ({
        email_address: email.emailAddress,
      })),
      username: user.username || undefined,
      profile_image_url: user.imageUrl,
      public_metadata: user.publicMetadata as { role?: string; tier?: string },
    };

    // Use shared utility to create/update user
    const result = await createOrUpdateUserProfile(clerkUserData);
    if (result.status === "error") {
      return serverError("User sync failed");
    }

    // Invalidate user profile cache after sync
    revalidateTag(CACHE_TAGS.USER_PROFILE, {});

    console.log(`✅ User ${userId} synced successfully (client-side): ${result.status}`);

    // Status only: the profile row (email included) never goes back over HTTP.
    return success({ status: result.status });
  } catch (error) {
    return serverError();
  }
}
