'use server';

import { z } from "zod";
import { requireAdminForAction, viewerIsAdmin } from "@/lib/admin-action";
import type { UpdateProfileData, SortOption, TierFilter } from "@/db/operations/userManagementOperations";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { requireConvexData } from "@/backend/projects/personal";
import { listUsersOnConvex, updateUserOnConvex } from "@/backend/admin";

// D07: the admin check is src/lib/admin-action.ts (no Clerk reads here), and
// the arguments are checked: a "use server" export takes whatever the caller
// sends.
const fetchUsersSchema = z.object({
  search: z.string().max(200).optional(),
  page: z.number().int().min(1).max(100000),
  sortBy: z.enum(['recent-edit', 'alphabetical', 'most-active']),
  tierFilter: z.enum(['all', 'free', 'pro', 'diamond']),
});

// Only these columns: updates used to go straight into .set(), so any profile
// column (user_id, id, ...) was writable.
const updateUserSchema = z.object({
  // A Convex ID (checked by Convex).
  profileId: z.string().min(1, "Invalid profile ID").max(64, "Invalid profile ID"),
  updates: z.object({
    username: z.string().optional(),
    full_name: z.string().max(200).optional(),
    // The edit form sends "" for a profile without an address.
    email_address: z.union([z.literal(""), z.string().email().max(320)]).optional(),
    tier: z.enum(['free', 'pro', 'diamond'], { message: "Invalid tier value" }).optional(),
  }),
});

/**
 * Fetch paginated users with optional search (Super Admin only)
 */
export async function fetchAllUsersAction(
  search?: string,
  page: number = 1,
  sortBy: SortOption = 'recent-edit',
  tierFilter: TierFilter = 'all'
) {
  await requireAdminForAction();

  const parsed = fetchUsersSchema.safeParse({ search, page, sortBy, tierFilter });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  const args = parsed.data;

  // D07-d: Convex's admin:listUsers. E03: no Supabase fallback.
  requireConvexData();
  return listUsersOnConvex(args.search, args.page, args.sortBy, args.tierFilter);
}

/**
 * Update a user's profile (Super Admin only)
 */
export async function updateUserAction(
  profileId: string,
  updates: UpdateProfileData
) {
  await requireAdminForAction();

  const parsed = updateUserSchema.safeParse({ profileId, updates });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  // Update the profile. D07-d: Convex's admin:updateUser (a closed patch,
  // audited, the username rules applied; the profile ID is a Convex ID).
  // E03: no Supabase fallback.
  requireConvexData();
  const updatedProfile = await updateUserOnConvex(parsed.data.profileId, parsed.data.updates);

  // Revalidate caches
  revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
  revalidateTag(CACHE_TAGS.USER_PROFILE, {});

  // If tier was updated, also invalidate tier cache
  if (parsed.data.updates.tier) {
    revalidateTag(CACHE_TAGS.USER_TIER, {});
  }

  // Revalidate the admin dashboard path
  revalidatePath('/dashboard/admin');

  return updatedProfile;
}

/**
 * Check if current user is super admin
 */
export async function checkIsSuperAdmin(): Promise<boolean> {
  return viewerIsAdmin();
}
