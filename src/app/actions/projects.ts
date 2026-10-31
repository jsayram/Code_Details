"use server";

import { projectWritesToConvex, updateProjectOnConvex } from "@/backend/projects/project-update";
import { changeLifecycleOnConvex, createProjectOnConvex } from "@/backend/projects/project-lifecycle";
import { changeFavoriteOnConvex } from "@/backend/projects/favorites";
import type { InsertProject } from "@/db/schema/projects";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { 
  unauthorizedError, 
  serverError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-errors";

const pathToRevalidate = "/projects";

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

// The read actions (getProjectById, getProjectBySlugServer, getProject,
// getUserOwnProjects, getProjectTagCounts) read Supabase and were removed in
// E03; the reads come from Convex through the API routes and the page.

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
