"use server";

import { unstable_cache } from "next/cache";
import { executeQuery } from "./server";
import { projects } from "./schema/projects";
import { profiles } from "./schema/profiles";
import { project_tags } from "./schema/project_tags";
import { tags } from "./schema/tags";
import { favorites } from "./schema/favorites";
import { SelectProject } from "./schema/projects";
import { eq, isNull, or, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

// createProjectServer moved to src/db/project-write.ts as insertProjectRow
// (D03, P08 R03): as an export of this "use server" file it inserted any row,
// any owner and any link, for any caller.

/**
 * Helper function to get tag names for a project
 */
export async function getProjectTagNames(projectId: string): Promise<string[]> {
  return await executeQuery(async (db) => {
    return (
      await db
        .select({ tagName: tags.name })
        .from(project_tags)
        .innerJoin(tags, eq(project_tags.tag_id, tags.id))
        .where(eq(project_tags.project_id, projectId))
    ).map((tag) => tag.tagName);
  });
}

// getProjectBySlugServer moved to src/db/project-read.ts (D02r, P08 R09): as
// an export of this "use server" file it was a callable server action that
// trusted its viewer arguments.
/**
 * Server-side function to get a user by ID
 */
export async function getUserById(userId: string) {
  return await executeQuery(async (db) => {
    // Get the user profile
    const [user] = await db
      .select({
        id: profiles.id,
        user_id: profiles.user_id,
        username: profiles.username,
        full_name: profiles.full_name,
        profile_image_url: profiles.profile_image_url,
        tier: profiles.tier,
        email_address: profiles.email_address,
        created_at: profiles.created_at,
        updated_at: profiles.updated_at,
      })
      .from(profiles)
      .where(eq(profiles.user_id, userId))
      .limit(1);

    // Return null instead of throwing to allow graceful handling
    if (!user) {
      console.warn(`User with ID ${userId} not found in database`);
      return null;
    }

    return user;
  });
}

/**
 * Cached version of getUserById
 * Cache: 5 minutes - User profiles change infrequently
 * Tags: ['user-profile'] - Invalidate on user profile updates
 */
export const getCachedUserById = unstable_cache(
  async (userId: string) => getUserById(userId),
  ['user-by-id'],
  {
    revalidate: 300, // 5 minutes
    tags: ['user-profile']
  }
);

// deleteProjectServer moved to src/db/project-write.ts as softDeleteProjectRow
// (D03, P08 R03): it soft-deleted any project for any caller.

// updateProjectServer moved to src/db/project-write.ts as updateProjectRow (D02,
// P08 R03): as an export of this "use server" file it wrote any column of any
// project for any caller.

/**
 * Server-side function to get all projects accessible to a user
 * Updated to include deleted projects
 */
export async function getAccessibleProjectsServer(
  userId: string,
  userTier?: string
): Promise<SelectProject[]> {
  return await executeQuery(async (db) => {
    // Get all projects with profile data and tags in a single query
    const projectsData = await db
      .select({
        project: {
          id: projects.id,
          title: projects.title,
          slug: projects.slug,
          description: projects.description,
          category: projects.category,
          user_id: projects.user_id,
          total_favorites: projects.total_favorites,
          url_links: projects.url_links,
          category_data: projects.category_data,
          field_order: projects.field_order,
          created_at: projects.created_at,
          updated_at: projects.updated_at,
          deleted_at: projects.deleted_at,
        },
        profile: {
          id: profiles.id,
          user_id: profiles.user_id,
          username: profiles.username,
          full_name: profiles.full_name,
          profile_image_url: profiles.profile_image_url,
          tier: profiles.tier,
          email_address: profiles.email_address,
          created_at: profiles.created_at,
          updated_at: profiles.updated_at,
        },
        tags: sql<string[]>`array_agg(distinct ${tags.name})`,
      })
      .from(projects)
      .leftJoin(profiles, eq(profiles.user_id, projects.user_id))
      .leftJoin(project_tags, eq(project_tags.project_id, projects.id))
      .leftJoin(tags, eq(tags.id, project_tags.tag_id))
      .where(isNull(projects.deleted_at))
      .groupBy(
        projects.id,
        profiles.id,
        profiles.user_id,
        profiles.username,
        profiles.full_name,
        profiles.profile_image_url,
        profiles.tier,
        profiles.email_address,
        profiles.created_at,
        profiles.updated_at
      )
      .orderBy(desc(projects.created_at));

    // Map the results to the expected format with proper typing
    return projectsData.map(({ project, profile, tags }) => ({
      ...project,
      tags: tags?.filter(Boolean) || [], // Filter out null values and provide empty array fallback
      owner_id: profile?.id || null,
      owner_user_id: profile?.user_id || null,
      owner_username: profile?.username || null,
      owner_full_name: profile?.full_name || null,
      owner_profile_image_url: profile?.profile_image_url || null,
      owner_tier: profile?.tier || null,
      owner_email_address: profile?.email_address || null,
      owner_created_at: profile?.created_at || null,
      owner_updated_at: profile?.updated_at || null,
    }));
  });
}

// getUserProjectsServer moved to src/db/project-read.ts (D02r): as an export
// of this "use server" file it listed anyone's projects, deleted included.
// isProjectOwner moved to src/db/project-write.ts (D02, P08 R03).

// getProjectUsersProfileBySlugServer moved to src/db/project-read.ts (D02r):
// it returned any owner's full profile row, email included, to any caller.
