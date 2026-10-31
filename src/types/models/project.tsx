// The project row type (E03: was the Drizzle inferred type; now src/types/rows.ts)
import type { SelectProject as DrizzleProject } from "@/types/rows";
import { ProjectCategory } from "@/constants/project-categories";

/**
 * Enhanced Project interface for application use
 * Extends database model with UI and application-specific properties
 */
export interface Project extends DrizzleProject {
  // Application-specific fields
  formattedDate?: string; // Human-readable date
  isFavorite?: boolean; // UI state for user favorites
  is_mine?: boolean; // D03: set on the Convex personal rows, which carry no owner ID
  displayBadge?: boolean; // UI presentation flag
  readableSlug?: string; // User-friendly version of the slug

  // Support for nested API response structure
  project?: DrizzleProject;

  // Note: tags are fetched from the related tables (tags and project_tags)
  // The tags array is added to the project by the getProjectTagNames() function
  tags?: string[];

  // Profile relationship fields
  profile?: {
    username: string | null;
    email_address: string | null;
    profile_image_url?: string | null;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
  // Category information
  category: ProjectCategory;
}
