'use server';

import { z } from "zod";
import { requireAdminForAction, viewerIsAdmin } from "@/lib/admin-action";
import { getAllUsers, updateUserProfile, type UpdateProfileData, type SortOption, type TierFilter } from "@/db/operations/userManagementOperations";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { projectWritesToConvex } from "@/backend/projects/project-update";
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
  // A UUID on Supabase, a Convex ID under the switches (checked by Convex).
  profileId: z.string().refine((id) => (projectWritesToConvex() ? id.length > 0 && id.length <= 64 : z.string().uuid().safeParse(id).success), "Invalid profile ID"),
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

  // D07-d: under both development switches, Convex's admin:listUsers.
  if (projectWritesToConvex()) return listUsersOnConvex(args.search, args.page, args.sortBy, args.tierFilter);

  // Fetch users with sort option and tier filter
  const result = await getAllUsers(args.search, args.page, 100, args.sortBy, args.tierFilter);

  return result;
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

  // Usernames: the shared rules run inside updateUserProfile (D04b), and only
  // when the name actually changes.

  // Update the profile. D07-d: under both development switches, Convex's
  // admin:updateUser (a closed patch, audited; the profile ID is a Convex ID).
  const updatedProfile = projectWritesToConvex()
    ? await updateUserOnConvex(profileId, parsed.data.updates)
    : await updateUserProfile(parsed.data.profileId, parsed.data.updates);

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
