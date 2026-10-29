// The project page's signed-in read, against Supabase (moved here from
// src/db/actions.ts in D02r, P08 R09). Deliberately not a "use server"
// module: Next exposes every export of one as a callable server action, and
// these take the viewer as an argument. Only server code calls them, with a
// viewer from the session (src/backend/projects/viewer-read.ts).
import { desc, eq, sql } from "drizzle-orm";
import { executeQuery } from "./server";
import { projects } from "./schema/projects";
import { profiles } from "./schema/profiles";
import { project_tags } from "./schema/project_tags";
import { tags } from "./schema/tags";
import type { SelectProject, SelectUserWithProject } from "./schema/projects";
import { getProjectTagNames } from "./actions";

/** Who is reading, from the session. Null means signed out. */
export type ProjectViewer = { userId: string; isAdmin: boolean } | null;

/**
 * A project by slug with its owner's profile fields. A soft-deleted project
 * comes back only for its owner or the admin; anyone else gets null, the same
 * as for a missing slug.
 */
export async function readProjectBySlug(slug: string, viewer: ProjectViewer): Promise<SelectProject | null> {
  return await executeQuery(async (db) => {
    const projectData = await db
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
      })
      .from(projects)
      .leftJoin(profiles, eq(profiles.user_id, projects.user_id))
      .where(eq(projects.slug, slug))
      .limit(1);

    if (!projectData.length) {
      return null;
    }

    const project = projectData[0].project;
    const profile = projectData[0].profile;

    // Only owner or admin can view soft-deleted projects
    if (project.deleted_at !== null) {
      const isOwner = !!viewer && project.user_id === viewer.userId;
      if (!isOwner && !viewer?.isAdmin) {
        return null;
      }
    }

    const tags = await getProjectTagNames(project.id);

    // Map the results to include owner information
    return {
      ...project,
      tags,
      owner_id: profile?.id || null,
      owner_user_id: profile?.user_id || null,
      owner_username: profile?.username || null,
      owner_full_name: profile?.full_name || null,
      owner_profile_image_url: profile?.profile_image_url || null,
      owner_tier: profile?.tier || null,
      owner_email_address: profile?.email_address || null,
      owner_created_at: profile?.created_at || null,
      owner_updated_at: profile?.updated_at || null,
    };
  });
}

/** The owner's profile row for a project slug (the page's second read). */
export async function readProjectOwnerProfileBySlug(slug: string): Promise<SelectUserWithProject | null> {
  return await executeQuery(async (db) => {
    const profileData = await db
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
      .from(projects)
      .innerJoin(profiles, eq(profiles.user_id, projects.user_id))
      .where(eq(projects.slug, slug))
      .limit(1);

    if (!profileData.length) {
      return null;
    }

    return { ...profileData[0] } as SelectUserWithProject;
  });
}

/** Every project a user owns, deleted included. Callers pass the session user. */
export async function getUserProjectsServer(
  userId: string
): Promise<SelectProject[]> {
  return await executeQuery(async (db) => {
    // Get projects with profile data and tags in a single query
    const projectsData = await db
      .select({
        project: projects,
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
        tags: sql<string[]>`array_agg(${tags.name})`,
      })
      .from(projects)
      .leftJoin(profiles, eq(profiles.user_id, projects.user_id))
      .leftJoin(project_tags, eq(project_tags.project_id, projects.id))
      .leftJoin(tags, eq(tags.id, project_tags.tag_id))
      .where(eq(projects.user_id, userId))
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

    // Map the results to the expected format
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
