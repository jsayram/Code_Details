// Row and result shapes the app still uses. E03 (slice 3): these were the
// Drizzle-inferred table types (src/db/schema) and the result types of the
// Supabase operations (src/db/operations). Drizzle and src/db are gone; the
// shapes are written out here unchanged, so the components and the Convex
// mappers (src/backend) keep their types.
import type { ProjectLink } from "@/types/project-links";

// Type for storing category-specific field values (flexible key-value storage)
export type CategoryData = Record<string, unknown>;

/** A project row (was projects.$inferSelect plus the relation fields). */
export type SelectProject = {
  id: string;
  user_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  category: string;
  total_favorites: string;
  url_links: ProjectLink[] | null;
  category_data: CategoryData | null;
  field_order: string[] | null;
  created_at: Date | null;
  updated_at: Date | null;
  deleted_at: Date | null;
} & {
  tags?: string[];
  category_data?: CategoryData | null;
  field_order?: string[] | null;
};

/** A project as the forms send it (was projects.$inferInsert plus the relation fields). */
export type InsertProject = {
  id?: string;
  user_id?: string | null;
  title: string;
  slug: string;
  description?: string | null;
  category?: string;
  total_favorites?: string;
  url_links?: ProjectLink[] | null;
  category_data?: CategoryData | null;
  field_order?: string[] | null;
  created_at?: Date | null;
  updated_at?: Date | null;
  deleted_at?: Date | null;
} & {
  tags?: string[];
  category_data?: CategoryData;
  field_order?: string[];
};

//relationship is project to user profile image
export type SelectProjectWithOwner = SelectProject & {
  owner_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  owner_full_name?: string | null;
  owner_profile_image_url?: string | null;
  owner_tier?: string | null;
  owner_email_address?: string | null;
  owner_created_at?: Date | null;
  owner_updated_at?: Date | null;
  category_data?: CategoryData | null;
  field_order?: string[] | null;
};

//user information from gathering project
export type SelectUserWithProject = SelectProject & {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  profile_image_url: string;
  tier: string;
  email_address: string;
  created_at: Date;
  updated_at: Date;
};

/** A tag suggestion row (was tag_submissions.$inferSelect). */
export type SelectTagSubmission = {
  id: string;
  project_id: string | null;
  tag_name: string;
  submitter_email: string;
  description: string | null;
  status: string;
  admin_notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  reviewed_at: Date | null;
};

export interface TagInfo {
  id: string;
  name: string;
  count?: number; // Optional count for tag usage statistics
}

export interface UserDashboardStats {
  totalProjects: number;
  totalFavorites: number; // Favorites user received on their projects
  totalFavoritesGiven: number; // Favorites user gave to other projects
  projectStats: {
    totalTags: number;
    activeThisWeek: number;
    mostPopularProject: {
      id: string;
      title: string;
      favorites: number;
    } | null;
  };
  recentActivity: {
    id: string;
    slug: string;
    title: string;
    action: string;
    timestamp: Date;
  }[];
  myProjects: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    total_favorites: number;
    category: string;
    created_at: Date | null;
    tags: string[];
  }[];
  myFavorites: {
    id: string;
    slug: string;
    title: string;
    owner_username: string | null;
    owner_user_id: string | null;
    category: string;
    favorited_at: Date | null;
    deleted_at: Date | null;
    tags: string[];
  }[];
  topTags: {
    name: string;
    count: number;
    projects: {
      id: string;
      slug: string;
      title: string;
    }[];
  }[];
  allTags: {
    name: string;
  }[];
  projectsWithFavorites: {
    id: string;
    slug: string;
    title: string;
    total_favorites: number;
  }[];
  myTagSubmissions: {
    id: string;
    tag_name: string;
    project_id: string | null;
    project_slug: string;
    project_title: string;
    project_deleted_at: Date | null;
    status: string;
    admin_notes: string | null;
    created_at: Date | null;
    is_now_available: boolean;
    project_tag_count: number;
    is_on_original_project?: boolean;
    other_projects_using_tag?: { slug: string; title: string }[];
  }[];
  recentAppreciation: {
    project_id: string;
    project_slug: string;
    project_title: string;
    favoriter_username: string | null;
    favoriter_profile_image: string | null;
    favorited_at: Date | null;
  }[];
}

export interface DashboardStats {
  totalProjects: number;
  activeUsers: number;
  recentActivity: {
    id: string;
    title: string;
    slug: string;
    action: string;
    username: string;
    timestamp: Date;
  }[];
  projectsNeedingAttention: {
    id: string;
    title: string;
    slug: string;
    owner: string;
    missingDescription: boolean;
    missingTags: boolean;
    issueCount: number;
  }[];
  mostPopularProjects: {
    id: string;
    title: string;
    slug: string;
    favorites: number;
    owner: string;
  }[];
  projectStats: {
    totalFavorites: number;
    totalTags: number;
    activeThisWeek: number;
  };
  topTags: {
    name: string;
    count: number;
  }[];
  allProjects: {
    id: string;
    title: string;
    slug: string;
    total_favorites: number;
    category: string;
    owner: string;
    created_at: Date | null;
    tag_count: number;
  }[];
  userGrowth: {
    totalUsers: number;
    newUsersThisWeek: number;
    newUsersThisMonth: number;
  };
  newUsersList: {
    id: string;
    user_id: string;
    username: string;
    full_name: string | null;
    email_address: string | null;
    tier: string | null;
    profile_image_url: string | null;
    created_at: Date | null;
  }[];
  categoryDistribution: {
    category: string;
    count: number;
    percentage: number;
  }[];
  engagementMetrics: {
    avgFavoritesPerProject: number;
    avgTagsPerProject: number;
    projectsWithoutFavorites: number;
    projectsWithoutTags: number;
  };
}

export interface UserProfile {
  id: string;
  user_id: string;
  username: string;
  full_name: string | null;
  email_address: string | null;
  tier: string | null;
  profile_image_url: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface PaginatedUsers {
  users: UserProfile[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UpdateProfileData {
  username?: string;
  full_name?: string;
  email_address?: string;
  tier?: string;
}

export type SortOption = 'recent-edit' | 'alphabetical' | 'most-active';

export type TierFilter = 'all' | 'free' | 'pro' | 'diamond';
