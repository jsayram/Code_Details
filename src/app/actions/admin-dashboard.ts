'use server';

import { requireAdminForAction } from "@/lib/admin-action";
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { requireConvexData } from "@/backend/projects/personal";
import { pendingSuggestionsOnConvex } from "@/backend/projects/tags";
import { dashboardStatsOnConvex } from "@/backend/admin";

export async function fetchAdminDashboardData(forceRefresh = false) {
  // D07: the shared admin check (src/lib/admin-action.ts), no Clerk reads here.
  await requireAdminForAction();

  // If force refresh is requested, revalidate the cache first
  if (forceRefresh) {
    console.log('[fetchAdminDashboardData] 🔄 Force refresh - revalidating admin dashboard cache');
    revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
    revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
  } else {
    console.log('[fetchAdminDashboardData] 📦 Using server cache (if available)');
  }

  // D07-c/d: the pending list and the stats come from Convex, read as the
  // admin (no shared cache: the reads need the session). E03: no Supabase fallback.
  requireConvexData();
  const [submissions, stats] = await Promise.all([pendingSuggestionsOnConvex(), dashboardStatsOnConvex()]);

  console.log('[fetchAdminDashboardData] ✅ Admin dashboard data returned from server');

  return {
    submissions,
    stats,
  };
}

// E03 (P08 R34): the admin "Clear cache" button. It used to POST client-chosen
// tags to /api/revalidate, which any signed-in caller could call; now the admin
// check runs first and the tag list is fixed (every server cache tag).
export async function clearServerCaches(): Promise<{ cleared: number }> {
  await requireAdminForAction();
  const tags = Object.values(CACHE_TAGS);
  for (const tag of tags) revalidateTag(tag, {});
  return { cleared: tags.length };
}
