"use server";

import { eq, sql, inArray } from "drizzle-orm";
import { projectWritesToConvex, updateProjectOnConvex } from "@/backend/projects/project-update";
import { changeLifecycleOnConvex, createProjectOnConvex } from "@/backend/projects/project-lifecycle";
import { changeFavoriteOnConvex } from "@/backend/projects/favorites";
import { InsertProject } from "@/db/schema/projects";
import { projects } from "@/db/schema/projects";
import { project_tags } from "@/db/schema/project_tags";
import { revalidatePath, unstable_cache, revalidateTag } from "next/cache";
import { mapDrizzleProjectToProject } from "@/types/models/project";
import { executeQuery } from "@/db/server";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { 
  unauthorizedError, 
  notFoundError, 
  serverError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-errors";
import { ErrorCode } from "@/constants/error-codes";
import { routeViewer } from "@/lib/auth-server";
import { getUserProjectsServer } from "@/db/project-read";

const pathToRevalidate = "/projects";

// D02r (P08 R09): these reads are callable server actions, so a soft-deleted
// project comes back only to its owner or the admin, judged by the session.
async function visibleToViewer<T extends { user_id: string | null; deleted_at: Date | null }>(row: T | null): Promise<T | null> {
  if (!row || row.deleted_at === null) return row;
  const viewer = await routeViewer();
  return viewer && (viewer.userId === row.user_id || viewer.isAdmin) ? row : null;
}

export async function getProjectById(projectId: string) {
  return visibleToViewer(await executeQuery(async (db) => {
    // Use more explicit query building pattern
    const results = await db
      .select({
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
        deleted_at: projects.deleted_at
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return results[0] || null;
  }));
}

// The unused cached wrappers (getCachedProjectById, getCachedProjectBySlug,
// getCachedProject) were removed in D02r: they were callable actions too, and
// the session check can't run inside unstable_cache.

// Get a single project by slug
export async function getProjectBySlugServer(slug: string) {
  return visibleToViewer(await executeQuery(async (db) => {
    const results = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);

    return results[0] || null;
  }));
}

// D03 (P08 R02): the writes below (create, update, delete, restore, purge,
// favorites) go to the Convex mutations, which take the caller from
// getViewer. D08g4f2: the Clerk-keyed Supabase writes are gone, so anything
// else (Better Auth alone, or no login) writes nothing.

// Server action to create a new project.
//
// D03 (P08 R02, SEC-D02-MASS): the creator comes from the session; the second
// argument is the client's own idea of its user ID, ignored and kept only so
// the callers don't change. Only the validated, whitelisted columns reach the
// insert (insertProjectRow), so the input can't set an owner, deleted_at,
// total_favorites, an ID or timestamps.
export async function createProject(
  project: InsertProject,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await createProjectOnConvex(project);
      if (result.success) revalidateAfterLifecycleChange();
      return result.success ? actionSuccess(result.data) : result;
    }
    return unauthorizedError("You must be signed in to create a project");
  } catch (error) {
    console.error("Failed to create project:", error);
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

// Server action to get a project by slug
export async function getProject(slug: string) {
  try {
    const project = await getProjectBySlugServer(slug);
    if (!project) {
      return notFoundError("Project", ErrorCode.PROJECT_NOT_FOUND);
    }
    return actionSuccess(mapDrizzleProjectToProject(project));
  } catch (error) {
    console.error("Failed to get project:", error);
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}


// Server action to soft-delete a project. D03 (R02): the owner comes from the
// session; the second argument is ignored.
export async function removeProject(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await changeLifecycleOnConvex("softDelete", id);
      if (!result.success) return result;
      revalidateAfterLifecycleChange(result.slug);
      return actionSuccess(null);
    }
    return unauthorizedError("You must be signed in to delete a project");
  } catch (error) {
    console.error("Failed to remove project:", error);
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

function revalidateAfterLifecycleChange(slug?: string) {
  revalidatePath(pathToRevalidate);
  if (slug) revalidatePath(`/projects/${slug}`);
  revalidateTag(CACHE_TAGS.PROJECTS, {});
  revalidateTag(CACHE_TAGS.USER_PROJECTS, {});
  revalidateTag(CACHE_TAGS.USER_OWN_PROJECTS, {});
  revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
}

// Server action to update a project.
//
// D02 (P08 R02): the caller comes from the session. The third argument is the
// client's own idea of its user ID; it is ignored and kept only so the
// callers don't change. Under both development switches (Convex read and
// Better Auth) the save goes to the Convex mutation, which learns the caller
// from getViewer. Under the Better Auth switch alone nothing is written to
// Supabase: there are no mixed-provider writes.
export async function updateProject(
  id: string,
  project: Partial<InsertProject> & { content_version?: number },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await updateProjectOnConvex(id, project);
      if (result.success) revalidateAfterUpdate(result.data.slug, result.previousSlug);
      if (result.success) return actionSuccess(result.data);
      return result;
    }
    return unauthorizedError("You must be signed in to update a project");
  } catch (error) {
    console.error("Failed to update project:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

function revalidateAfterUpdate(slug?: string | null, previousSlug?: string | null) {
  // Revalidate the projects list page
  revalidatePath(pathToRevalidate);
  // Revalidate the specific project page (using the new slug if changed)
  if (slug) revalidatePath(`/projects/${slug}`);
  if (previousSlug && previousSlug !== slug) revalidatePath(`/projects/${previousSlug}`);
  revalidateTag(CACHE_TAGS.PROJECTS, {});
  revalidateTag(CACHE_TAGS.USER_PROJECTS, {});
  revalidateTag(CACHE_TAGS.USER_OWN_PROJECTS, {});
  revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
}

// getUserProjects(userId), getAllProjects and their cached wrappers were
// removed (D04a, P08 R07): callable actions that handed any caller every
// owner's provider subject, profile UUID and tier, and any user's project
// list. Nothing in the app called them; the cache test page reads
// readAllActiveProjects on the server.

// Server action to get projects created by the current user. D02r: the
// user is the session's; it used to be an argument, so anyone could list
// anyone's projects, deleted ones included. The cached wrapper went with it.
export async function getUserOwnProjects() {
  try {
    const userId = (await routeViewer())?.userId;
    if (!userId) {
      return unauthorizedError("User ID is required");
    }

    const projects = await getUserProjectsServer(userId);

    // Map the data to our Project type
    const mappedProjects = projects.map(mapDrizzleProjectToProject);
    console.log(`Successfully fetched ${mappedProjects.length} user projects`);

    return actionSuccess(mappedProjects);
  } catch (error) {
    console.error("Failed to get user's own projects:", error);
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

// Server action to permanently delete a project. D03 (R02): the owner comes
// from the session; the second argument is ignored. Only a project in the
// graveyard can be purged.
export async function permanentlyDeleteProject(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await changeLifecycleOnConvex("purge", id);
      if (!result.success) return result;
      revalidateAfterLifecycleChange(result.slug);
      return actionSuccess(null);
    }
    return unauthorizedError("You must be signed in to delete a project");
  } catch (error) {
    console.error("Failed to permanently delete project:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

// Server action to restore a deleted project. D03 (R02): the owner comes from
// the session; the second argument is ignored. Restore is valid only from
// deleted (P07 §5.11).
export async function restoreProject(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await changeLifecycleOnConvex("restore", id);
      if (!result.success) return result;
      revalidateAfterLifecycleChange(result.slug);
      return actionSuccess(null);
    }
    return unauthorizedError("You must be signed in to restore a project");
  } catch (error) {
    console.error("Failed to restore project:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

// Favorite and unfavorite. D05 (P08 R02): the caller comes from the session;
// the second argument is the client's own idea of its user ID, ignored and
// kept only so the callers don't change. Both are idempotent and move
// total_favorites only when a row is really added or removed (R25). The
// writes live in src/db/favorite-write.ts; under both development switches
// they go to the Convex favorites:add/remove mutations instead.
export async function addProjectFavorite(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await changeFavoriteOnConvex("add", projectId);
      if (!result.success) return result;
      revalidateAfterFavorite();
      return actionSuccess(undefined);
    }
    return unauthorizedError("You must be signed in to favorite a project");
  } catch (error) {
    console.error("Failed to add favorite:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

export async function removeProjectFavorite(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clientUserId?: string | null
) {
  try {
    if (projectWritesToConvex()) {
      const result = await changeFavoriteOnConvex("remove", projectId);
      if (!result.success) return result;
      revalidateAfterFavorite();
      return actionSuccess(undefined);
    }
    return unauthorizedError("You must be signed in to favorite a project");
  } catch (error) {
    console.error("Failed to remove favorite:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

function revalidateAfterFavorite() {
  revalidatePath(pathToRevalidate);
  revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
  revalidateTag(CACHE_TAGS.PROJECTS, {});
  revalidateTag(CACHE_TAGS.USER_PROJECTS, {});
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// D03 (SEC-D03-SQLI): the IDs come from the client (this is a callable
// action), so they are bound as parameters, never spliced into the SQL, and
// anything that isn't a UUID is dropped.
export async function getProjectTagCounts(projectIds: string[]) {
  const ids = Array.isArray(projectIds)
    ? [...new Set(projectIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))].slice(0, 1000)
    : [];
  return executeQuery(async (db) => {
    if (ids.length === 0) return {};

    const tagCounts = await db
      .select({
        project_id: project_tags.project_id,
        count: sql<number>`count(*)`,
      })
      .from(project_tags)
      .where(inArray(project_tags.project_id, ids))
      .groupBy(project_tags.project_id);

    const result: Record<string, number> = {};
    tagCounts.forEach(({ project_id, count }) => {
      result[project_id] = Number(count);
    });

    return result;
  });
}
