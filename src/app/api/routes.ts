/**
 * Centralized API route definitions
 * All API routes should be defined here to maintain consistency and avoid duplication
 */

export const API_ROUTES = {
  PROJECTS: {
    BASE: "/api/projects",
    BY_SLUG: (slug: string) => `/api/projects?slug=${encodeURIComponent(slug)}`,
    BY_ID: (id: string) => `/api/projects?id=${encodeURIComponent(id)}`,
    WITH_FILTERS: (params: {
      showAll?: boolean;
      difficulty?: string;
      tag?: string;
      userId?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.showAll) searchParams.set("showAll", "true");
      if (params.difficulty) searchParams.set("difficulty", params.difficulty);
      if (params.tag) searchParams.set("tag", params.tag);
      if (params.userId) searchParams.set("userId", params.userId);
      const queryString = searchParams.toString();
      return `/api/projects${queryString ? `?${queryString}` : ""}`;
    },
  },
  TIERS: {
    USER_TIER: "/api/tiers/user-tier",
  },
  AUTH: {
    USER: (userId: string) => `/users/${userId}`,
  },
  TEST: {
    BASE: "/api/test",
  },
} as const;
