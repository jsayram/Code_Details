'use server';

import { personalReadsFromConvex } from "@/backend/projects/personal";
import { convexDashboardStats } from "@/backend/projects/dashboard";

export async function fetchUserDashboardData() {
  // DEF-FLIP-FRESHACCT (D08g4f2): the stats come from the session's own Convex
  // lists. Not cached: each call is the session's own. E03: the Supabase path
  // (and its per-user cache) is gone; with no local Convex there is no data.
  if (!personalReadsFromConvex()) throw new Error("Unauthorized: User not logged in");
  const stats = await convexDashboardStats();
  if (!stats) throw new Error("Unauthorized: User not logged in");
  return { stats };
}
