'use server';

import { requireAdminForAction } from "@/lib/admin-action";
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { DEFAULT_TOP_CONTRIBUTORS } from "@/constants/project-limits";
import { requireConvexData } from "@/backend/projects/personal";
import { tagPipelineOnConvex, topContributorsOnConvex, topContributorsPublicOnConvex } from "@/backend/admin";

export interface TopContributor {
  user_id: string;
  username: string;
  full_name: string | null;
  profile_image_url: string | null;
  tier: string | null;
  projects_count: number;
  favorites_received: number;
  tag_submissions_count: number;
  approved_tags_count: number;
  contribution_score: number;
}

/**
 * What the public user directory gets (D04a, P08 R07): no provider subject
 * and no tier, and a legacy email-shaped username cut to its local part.
 */
export type PublicTopContributor = Omit<TopContributor, "user_id" | "tier">;

export interface TagPipelineMetrics {
  totalSubmissions: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number;
  rejectionRate: number;
  avgReviewTimeHours: number | null;
  submissionsByStatus: {
    status: string;
    count: number;
    percentage: number;
  }[];
  recentSubmissions: {
    id: string;
    tag_name: string;
    submitter_email: string;
    status: string;
    created_at: Date;
    reviewed_at: Date | null;
    review_time_hours: number | null;
  }[];
  topSubmitters: {
    submitter_email: string;
    total_submissions: number;
    approved: number;
    pending: number;
    rejected: number;
    approval_rate: number;
  }[];
}

// The admin check moved to src/lib/admin-action.ts (D04e).
const checkAdminAccess = requireAdminForAction;

// Wrapper functions that support force refresh
export async function getTopContributors(limit: number, forceRefresh = false) {
  await checkAdminAccess();
  if (forceRefresh) {
    console.log('[getTopContributors] 🔄 Force refresh - revalidating contributors cache');
    revalidateTag(CACHE_TAGS.CONTRIBUTORS, {});
  } else {
    console.log('[getTopContributors] 📦 Using server cache for contributors (if available)');
  }
  // D07-d: Convex, read as the admin (no shared cache). E03: no Supabase fallback.
  requireConvexData();
  const result = await topContributorsOnConvex(limit);
  console.log('[getTopContributors] ✅ Contributors data returned');
  return result;
}

export async function getTagPipelineAnalytics(forceRefresh = false) {
  await checkAdminAccess();
  if (forceRefresh) {
    console.log('[getTagPipelineAnalytics] 🔄 Force refresh - revalidating tag pipeline cache');
    revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
  } else {
    console.log('[getTagPipelineAnalytics] 📦 Using server cache for tag pipeline (if available)');
  }
  requireConvexData();
  const result = await tagPipelineOnConvex();
  console.log('[getTagPipelineAnalytics] ✅ Tag pipeline data returned');
  return result;
}

export async function fetchTopContributors(limit: number = DEFAULT_TOP_CONTRIBUTORS): Promise<TopContributor[]> {
  await checkAdminAccess();
  requireConvexData();
  return topContributorsOnConvex(limit);
}

// Public version for user list - excludes tag metrics to prevent spam
export async function fetchTopContributorsPublic(limit: number = DEFAULT_TOP_CONTRIBUTORS): Promise<PublicTopContributor[]> {
  // D07-d: Convex's public list (listed projects only). E03: no Supabase fallback.
  requireConvexData();
  return topContributorsPublicOnConvex(limit);
}

export async function fetchTagPipelineAnalytics(): Promise<TagPipelineMetrics> {
  await checkAdminAccess();
  requireConvexData();
  return tagPipelineOnConvex();
}
