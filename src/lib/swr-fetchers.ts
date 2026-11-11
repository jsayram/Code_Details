import { API_ROUTES } from "@/constants/api-routes";
import { searchTagsAction } from "@/app/actions/tags";
import { ProjectCategory } from "@/constants/project-categories";

/**
 * Fetcher for projects API with filters
 * Used by useProjects hook
 */
export async function projectsFetcher(url: string) {
  const response = await fetch(url);

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error("Server responded with non-JSON content");
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Failed to fetch projects");
  }

  return result;
}

/**
 * Fetcher for tags using server action
 * Used by useTags hook
 */
export async function tagsFetcher(): Promise<{ id: string; name: string }[]> {
  // Server action wrapper - SWR needs a fetcher function
  const tags = await searchTagsAction("");
  return tags;
}

/**
 * Fetcher for user tier
 * Used by useUserTier hook
 */
export async function userTierFetcher(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  return result;
}

/**
 * Generate cache key for projects based on filters
 */
export function getProjectsCacheKey(params: {
  showAll?: boolean;
  userId?: string;
  username?: string;
  category?: ProjectCategory | "all";
  showFavorites?: boolean;
  showDeleted?: boolean;
  sortBy?: string;
  page?: number;
  limit?: number;
  tags?: string[];
}): string {
  return API_ROUTES.PROJECTS.WITH_FILTERS(params);
}

/**
 * Cache key constants for SWR
 */
export const SWR_KEYS = {
  TAGS: "tags",
  CATEGORY_COUNTS: "category-counts",
  USER_CATEGORY_COUNTS: (username: string) => `user-category-counts:${username}`,
  PROFILES: "profiles",
  USER_TIER: (userId: string) => `/api/tiers/user-tier?userId=${userId}`,
  PROJECTS: (filters: Record<string, unknown>) => 
    `projects:${JSON.stringify(filters)}`,
  DASHBOARD_STATS: "dashboard-stats",
} as const;

/**
 * Server-side cache tag constants
 * These are Next.js cache tags used with unstable_cache and revalidateTag
 */
export const CACHE_TAGS = {
  // Project-related
  PROJECTS: "projects",
  PROJECT_DETAIL: "project-detail",
  USER_PROJECTS: "user-projects",
  USER_OWN_PROJECTS: "user-own-projects",
  
  // Tag-related
  TAGS: "tags",
  TAG_SUBMISSIONS: "tag-submissions",
  
  // User-related
  USER_PROFILE: "user-profile",
  USER_TIER: "user-tier",
  USER_DASHBOARD: "user-dashboard",
  
  // Admin-related
  ADMIN_DASHBOARD: "admin-dashboard",
  CONTRIBUTORS: "contributors",
  
  // General
  DASHBOARD: "dashboard",
} as const;
