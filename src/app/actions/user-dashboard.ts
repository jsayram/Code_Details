'use server';

import { getUserDashboardStats } from "@/db/operations/userDashboardOperations";
import { routeViewer } from "@/lib/auth-server";
import { unstable_cache, revalidateTag } from 'next/cache';
import { CACHE_TAGS } from "@/lib/swr-fetchers";

// Cache user dashboard stats for 2 minutes. Not exported (D02r): every export
// of a "use server" file is a callable server action, and this one took any
// userId. The cache key is the session's own user ID.
const getCachedUserDashboardStats = unstable_cache(
  async (userId: string) => {
    console.log('[getCachedUserDashboardStats] 🗄️ Querying database');
    const result = await getUserDashboardStats(userId);
    console.log('[getCachedUserDashboardStats] ✅ Database query complete');
    return result;
  },
  ['user-dashboard-stats'],
  {
    revalidate: 120, // 2 minutes
    tags: ['user-dashboard']
  }
);

export async function fetchUserDashboardData(forceRefresh = false) {
  // D02r: the user comes from the session only (routeUserId: Clerk by
  // default, the Clerk-era account under the Better Auth switch).
  const userId = (await routeViewer())?.userId;
  
  if (!userId) {
    throw new Error("Unauthorized: User not logged in");
  }

  // If force refresh is requested, revalidate the cache first
  if (forceRefresh) {
    console.log('[fetchUserDashboardData] 🔄 Force refresh - revalidating server cache');
    revalidateTag(CACHE_TAGS.USER_DASHBOARD, {});
  } else {
    console.log('[fetchUserDashboardData] 📦 Checking Next.js server cache...');
  }

  const stats = await getCachedUserDashboardStats(userId);
  console.log('[fetchUserDashboardData] ✅ Data returned from server');

  // The user ID isn't returned: nothing reads it, and under the Better Auth
  // switch it is the Clerk-era subject, which stays on the server (D11).
  return {
    stats,
  };
}
