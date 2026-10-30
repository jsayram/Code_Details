'use server';

import { getDashboardStats } from "@/db/operations/dashboardOperations";
import { listPendingTagSubmissions } from "@/db/operations/tag-submission-operations";
import { requireAdminForAction } from "@/lib/admin-action";
import { unstable_cache, revalidateTag } from 'next/cache';
import { CACHE_TAGS } from "@/lib/swr-fetchers";

// Cache admin dashboard stats for 2 minutes. SEC-D04-DASH: not exported (an
// export of this "use server" file is callable by anyone; the stats carry new
// users' emails, tiers and provider subjects). fetchAdminDashboardData checks
// the admin first.
const getCachedDashboardStats = unstable_cache(
  async () => getDashboardStats(),
  ['admin-dashboard-stats'],
  {
    revalidate: 120, // 2 minutes
    tags: ['admin-dashboard']
  }
);

// Unchecked inside the cache (unstable_cache can't read the session); the
// admin check runs first in fetchAdminDashboardData.
const getCachedTagSubmissions = unstable_cache(
  async () => listPendingTagSubmissions(),
  ['admin-tag-submissions'],
  {
    revalidate: 60, // 1 minute for more frequently changing data
    tags: ['admin-dashboard', 'tag-submissions']
  }
);

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

  const [submissions, stats] = await Promise.all([
    getCachedTagSubmissions(),
    getCachedDashboardStats(),
  ]);

  console.log('[fetchAdminDashboardData] ✅ Admin dashboard data returned from server');

  return {
    submissions,
    stats,
  };
}
