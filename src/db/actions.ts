"use server";

import { unstable_cache } from "next/cache";
import { executeQuery } from "./server";
import { projects } from "./schema/projects";
import { profiles } from "./schema/profiles";
import { project_tags } from "./schema/project_tags";
import { tags } from "./schema/tags";
import { favorites } from "./schema/favorites";
import {
  InsertProject,
  SelectProject,
} from "./schema/projects";
import { eq, isNull, or, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

/**
 * Server-side function to create a new project
 */
export async function createProjectServer(
  project: InsertProject
): Promise<SelectProject> {
  return await executeQuery(async (db) => {
    // Create the project
    const [createdProject] = await db
      .insert(projects)
      .values(project)
      .returning();

    // If there are tags, associate them with the project
    if (project.tags && project.tags.length > 0) {
      // For each tag, either get it or create it if it doesn't exist
      for (const tagName of project.tags) {
        // Check if tag exists
        let tagId = null;
        const existingTags = await db
          .select({ id: tags.id })
          .from(tags)
          .where(eq(tags.name, tagName.trim()));

        if (existingTags.length > 0) {
          tagId = existingTags[0].id;
        } else {
          // Create the tag
          const [createdTag] = await db
            .insert(tags)
            .values({ name: tagName.trim() })
            .returning({ id: tags.id });
          tagId = createdTag.id;
        }

        // Create a relation between project and tag
        await db.insert(project_tags).values({
          project_id: createdProject.id,
          tag_id: tagId,
        });
      }
    }

    // Return the created project with tags
    const projectWithTags = {
      ...createdProject,
      tags: project.tags || [],
    };

    return projectWithTags;
  });
}

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

/**
 * Server-side function to soft delete a project
 */
export async function deleteProjectServer(id: string): Promise<SelectProject> {
  return await executeQuery(async (db) => {
    // Update the project to set deleted_at timestamp
    const [updatedProject] = await db
      .update(projects)
      .set({
        deleted_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    if (!updatedProject) {
      throw new Error(`Project with ID ${id} not found`);
    }

    // Get the tags associated with the project
    const tags = await getProjectTagNames(id);

    // Return the soft-deleted project with its tags
    return { ...updatedProject, tags };
  });
}

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
