"use server";

import { eq, sql, and, inArray } from "drizzle-orm";
import {
  insertProjectRow,
  isProjectOwner,
  purgeProjectRow,
  restoreProjectRow,
  softDeleteProjectRow,
  updateProjectRow,
  type ProjectUpdate,
} from "@/db/project-write";
import { checkCategoryData } from "@/backend/projects/project-update-rules";
import { projectWritesToConvex, updateProjectOnConvex } from "@/backend/projects/project-update";
import { changeLifecycleOnConvex, createProjectOnConvex } from "@/backend/projects/project-lifecycle";
import { chooseAuthBackend } from "@/backend/auth";
import { auth } from "@clerk/nextjs/server";
import { InsertProject } from "@/db/schema/projects";
import { projects } from "@/db/schema/projects";
import { project_tags } from "@/db/schema/project_tags";
import { revalidatePath, unstable_cache, revalidateTag } from "next/cache";
import { mapDrizzleProjectToProject } from "@/types/models/project";
import { executeQuery } from "@/db/server";
import { favorites } from "@/db/schema/favorites";
import { getProfileByUserId } from "@/db/operations";
import { createProjectSchema, updateProjectSchema } from "@/types/schemas";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { 
  unauthorizedError, 
  notOwnerError, 
  notFoundError, 
  zodValidationError, 
  validationError,
  serverError,
  actionSuccess,
  type ActionResult
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

// D03 (P08 R02): the Supabase writes below (create, delete, restore, purge)
// take the caller from the Clerk session. Under both development switches
// they go to the Convex lifecycle mutations instead, which take the caller
// from getViewer; under the Better Auth switch alone they write nothing:
// there are no mixed-provider writes.
async function clerkWriter(): Promise<string | null> {
  if (chooseAuthBackend().backend !== "clerk") return null;
  const { userId } = await auth();
  return userId ?? null;
}

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
    const userId = await clerkWriter();
    if (!userId) {
      return unauthorizedError("You must be signed in to create a project");
    }

    // Validate input with Zod schema
    const validationResult = createProjectSchema.safeParse({
      title: project.title,
      slug: project.slug,
      description: project.description,
      category: project.category,
      url_links: project.url_links,
      tags: project.tags || [],
      category_data: project.category_data,
      field_order: project.field_order,
    });

    if (!validationResult.success) {
      return zodValidationError(validationResult);
    }

    // Use validated and transformed data
    const validatedData = validationResult.data;

    // D02 (R29): url fields in the project details are http(s) only.
    const detailIssues = checkCategoryData(validatedData.category, validatedData.category_data, validatedData.field_order, { strictKeys: false });
    if (detailIssues.length) return validationError(detailIssues[0].message, detailIssues);

    const newProject = await insertProjectRow(userId, {
      title: validatedData.title,
      slug: validatedData.slug,
      description: validatedData.description,
      category: validatedData.category,
      url_links: validatedData.url_links,
      tags: validatedData.tags,
      category_data: validatedData.category_data ?? null,
      field_order: validatedData.field_order ?? null,
    });
    // Revalidate the projects list page
    revalidatePath(pathToRevalidate);
    revalidateTag(CACHE_TAGS.PROJECTS, {});
    revalidateTag(CACHE_TAGS.USER_PROJECTS, {});
    revalidateTag(CACHE_TAGS.USER_OWN_PROJECTS, {});
    return actionSuccess(mapDrizzleProjectToProject(newProject));
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
    const userId = await clerkWriter();
    if (!userId) {
      return unauthorizedError("You must be signed in to delete a project");
    }

    // First check if the user is the owner of this project
    const isOwner = await isProjectOwner(id, userId);
    if (!isOwner) {
      return notOwnerError("project");
    }

    const deletedProject = await softDeleteProjectRow(id);
    if (!deletedProject) {
      return notFoundError("Project", ErrorCode.PROJECT_NOT_FOUND);
    }
    revalidateAfterLifecycleChange();
    return actionSuccess(mapDrizzleProjectToProject(deletedProject));
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
    if (chooseAuthBackend().backend !== "clerk") {
      return unauthorizedError("You must be signed in to update a project");
    }
    const { userId } = await auth();
    if (!userId) {
      return unauthorizedError("You must be signed in to update a project");
    }

    // First check if the user is the owner of this project
    const isOwner = await isProjectOwner(id, userId);
    if (!isOwner) {
      return notOwnerError("project");
    }

    // Validate input with Zod schema
    const validationResult = updateProjectSchema.safeParse({
      title: project.title,
      slug: project.slug,
      description: project.description,
      category: project.category,
      url_links: project.url_links,
      tags: project.tags,
      category_data: project.category_data,
      field_order: project.field_order,
    });

    if (!validationResult.success) {
      return zodValidationError(validationResult);
    }

    // Use validated and transformed data
    const validatedData = validationResult.data;

    // R29: url fields in the project details are http(s) only, checked against
    // the category the project will be saved under. Unknown keys stay accepted
    // here (see project-update-rules.ts).
    if (validatedData.category_data || validatedData.field_order) {
      const category = validatedData.category ?? (await getProjectCategory(id));
      const issues = checkCategoryData(category, validatedData.category_data, validatedData.field_order, { strictKeys: false });
      if (issues.length) return validationError(issues[0].message, issues);
    }

    // Only the whitelisted columns reach the row (updateProjectRow).
    const update: ProjectUpdate = {};
    if (validatedData.title !== undefined) update.title = validatedData.title;
    if (validatedData.slug !== undefined) update.slug = validatedData.slug;
    if (validatedData.description !== undefined) update.description = validatedData.description;
    if (validatedData.category !== undefined) update.category = validatedData.category;
    if (validatedData.url_links !== undefined) update.url_links = validatedData.url_links;
    if (validatedData.tags !== undefined) update.tags = validatedData.tags;
    if (validatedData.category_data !== undefined) update.category_data = validatedData.category_data ?? null;
    if (validatedData.field_order !== undefined) update.field_order = validatedData.field_order ?? null;

    const updatedProject = await updateProjectRow(id, update);
    revalidateAfterUpdate(updatedProject.slug || validatedData.slug);
    return actionSuccess(mapDrizzleProjectToProject(updatedProject));
  } catch (error) {
    console.error("Failed to update project:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

async function getProjectCategory(id: string): Promise<string> {
  const [row] = await executeQuery((db) => db.select({ category: projects.category }).from(projects).where(eq(projects.id, id)));
  return row?.category ?? "other";
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
    const userId = await clerkWriter();
    if (!userId) {
      return unauthorizedError("You must be signed in to delete a project");
    }

    // First check if the user is the owner of this project
    const isOwner = await isProjectOwner(id, userId);
    if (!isOwner) {
      return notOwnerError("project");
    }

    if (!(await purgeProjectRow(id))) {
      return validationError("Project must be in the graveyard before permanent deletion");
    }

    revalidateAfterLifecycleChange();
    return actionSuccess(null);
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
    const userId = await clerkWriter();
    if (!userId) {
      return unauthorizedError("You must be signed in to restore a project");
    }

    // First check if the user is the owner of this project
    const isOwner = await isProjectOwner(id, userId);
    if (!isOwner) {
      return notOwnerError("project");
    }

    const restoredProject = await restoreProjectRow(id);
    if (!restoredProject) {
      return validationError("Only a deleted project can be restored");
    }

    revalidateAfterLifecycleChange();
    return actionSuccess(mapDrizzleProjectToProject(restoredProject));
  } catch (error) {
    console.error("Failed to restore project:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

// Server action to add a favorite to a project
export async function addProjectFavorite(
  projectId: string,
  userId: string
) {
  try {
    if (!userId || !projectId) {
      return unauthorizedError("Both user ID and project ID are required");
    }

    // First get the profile ID for the user
    const profile = await getProfileByUserId(userId);
    if (!profile) {
      return notFoundError("User profile", ErrorCode.PROFILE_NOT_FOUND);
    }

    await executeQuery(async (db) => {
      // Check if favorite already exists
      const existingFavorite = await db
        .select()
        .from(favorites)
        .where(
          and(
            eq(favorites.project_id, projectId),
            eq(favorites.profile_id, profile.id)
          )
        )
        .limit(1);

      if (existingFavorite.length === 0) {
        // Create new favorite and increment total_favorites in a transaction
        await db.transaction(async (tx) => {
          // Add the favorite
          await tx
            .insert(favorites)
            .values({
              project_id: projectId,
              profile_id: profile.id,
            });

          // Increment total_favorites
          await tx
            .update(projects)
            .set({ 
              total_favorites: sql`total_favorites + 1`,
              updated_at: new Date()
            })
            .where(eq(projects.id, projectId));
        });
      }
    });

    revalidatePath(pathToRevalidate);
    revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
    revalidateTag(CACHE_TAGS.PROJECTS, {});
    revalidateTag(CACHE_TAGS.USER_PROJECTS, {});
    return actionSuccess(undefined);
  } catch (error) {
    console.error("Failed to add favorite:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
}

// Server action to remove a favorite from a project
export async function removeProjectFavorite(
  projectId: string,
  userId: string
) {
  try {
    if (!userId || !projectId) {
      return unauthorizedError("Both user ID and project ID are required");
    }

    // First get the profile ID for the user
    const profile = await getProfileByUserId(userId);
    if (!profile) {
      return notFoundError("User profile", ErrorCode.PROFILE_NOT_FOUND);
    }

    await executeQuery(async (db) => {
      // Delete favorite and decrement total_favorites in a transaction
      await db.transaction(async (tx) => {
        // Remove the favorite
        await tx
          .delete(favorites)
          .where(
            and(
              eq(favorites.project_id, projectId),
              eq(favorites.profile_id, profile.id)
            )
          );

        // Decrement total_favorites, ensuring it doesn't go below 0
        await tx
          .update(projects)
          .set({ 
            total_favorites: sql`GREATEST(total_favorites - 1, 0)`,
            updated_at: new Date()
          })
          .where(eq(projects.id, projectId));
      });
    });

    revalidatePath(pathToRevalidate);
    revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
    revalidateTag(CACHE_TAGS.PROJECTS, {});
    revalidateTag(CACHE_TAGS.USER_PROJECTS, {});
    return actionSuccess(undefined);
  } catch (error) {
    console.error("Failed to remove favorite:");
    return serverError(error, error instanceof Error ? error.message : "Unknown error occurred");
  }
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
