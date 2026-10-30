"use server";

/**
 * Project Images Server Actions
 * RFC 7807 compliant server actions for managing project images
 */

import {
  getProjectImages,
  getProjectCoverImage,
} from "@/db/operations/project-image-operations";
import { getProjectById } from "@/app/actions/projects";
import {
  SelectProjectImage,
  ImageType,
  IMAGE_TYPES,
  AspectRatio,
} from "@/db/schema/project_images";
import {
  type ActionResult,
  actionSuccess,
  unauthorizedError,
  notFoundError,
  validationError,
  serverError,
} from "@/lib/action-errors";
import {
  attachImageOnConvex,
  coverImageOnConvex,
  deleteImageOnConvex,
  imageReadsFromConvex,
  imageUploadUrlOnConvex,
  imageWritesToConvex,
  listImagesOnConvex,
  reorderImagesOnConvex,
  setCoverOnConvex,
} from "@/backend/projects/images";

// =============================================================================
// Types
// =============================================================================

export interface ImageUploadInput {
  projectId: string;
  /** Supabase path; "" on the Convex path. */
  storagePath: string;
  /** Convex path only: the ID the upload URL returned. */
  storageId?: string;
  /** Ignored: the server derives the URL from the validated path (D06, R11). */
  storageUrl?: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  imageType: ImageType;
  aspectRatio?: AspectRatio;
  altText?: string;
  caption?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

// D06 (P08 R02/R11/R12/R33). Writes go to Convex (the caller from getViewer).
// D08g4f2: the Clerk-keyed Supabase writes are gone, so anything else refuses,
// as the project and favorite writes do. Reads go through getProjectById,
// which hides a soft-deleted project from everyone but its owner and admins.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The project when the viewer may see it (getProjectById's rule), else null.
 */
async function visibleProject(projectId: string) {
  if (typeof projectId !== "string" || !UUID_RE.test(projectId)) return null;
  return getProjectById(projectId);
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Where the browser uploads the file: a one-time Convex upload URL after the
 * owner, privacy and limit checks (D06-b). D08g4f2: the Supabase flow is gone,
 * so off the Convex path this refuses (the result type keeps "supabase" so the
 * uploader doesn't change until E03).
 */
export async function beginProjectImageUploadAction(
  projectId: string,
  imageType: ImageType
): Promise<ActionResult<{ backend: "supabase" } | { backend: "convex"; uploadUrl: string }>> {
  try {
    // D08g4f2: no Supabase upload any more (its registration needed a Clerk login).
    if (!imageWritesToConvex()) return unauthorizedError("Authentication required to upload images");
    if (!IMAGE_TYPES.includes(imageType)) {
      return validationError(`Invalid image type. Must be one of: ${IMAGE_TYPES.join(", ")}`);
    }
    const result = await imageUploadUrlOnConvex(projectId, imageType);
    return "uploadUrl" in result ? actionSuccess({ backend: "convex" as const, uploadUrl: result.uploadUrl }) : result;
  } catch (error) {
    console.error("Error starting image upload:", error);
    return serverError(error, "Failed to start upload");
  }
}

/**
 * Create a new project image record after upload
 */
export async function createProjectImageAction(
  input: ImageUploadInput
): Promise<ActionResult<SelectProjectImage>> {
  try {
    if (!input || typeof input !== "object") {
      return validationError("Invalid image");
    }

    if (imageWritesToConvex()) {
      if (typeof input.storageId !== "string" || !IMAGE_TYPES.includes(input.imageType)) {
        return validationError("Invalid image");
      }
      const attached = await attachImageOnConvex({
        projectId: String(input.projectId),
        storageId: input.storageId,
        kind: input.imageType,
        fileName: String(input.fileName ?? ""),
        ...(input.width != null && { width: input.width }),
        ...(input.height != null && { height: input.height }),
        ...(input.aspectRatio != null && { aspectRatio: input.aspectRatio }),
        ...(input.altText != null && { altText: input.altText }),
        ...(input.caption != null && { caption: input.caption }),
      });
      return "success" in attached ? attached : actionSuccess(attached);
    }

    return unauthorizedError("Authentication required to upload images");
  } catch (error) {
    console.error("Error creating project image:", error);
    return serverError(error, "Failed to create image");
  }
}

/**
 * Get all images for a project the viewer may see
 */
export async function getProjectImagesAction(
  projectId: string,
  imageType?: ImageType
): Promise<ActionResult<SelectProjectImage[]>> {
  try {
    if (imageType !== undefined && !IMAGE_TYPES.includes(imageType)) {
      return validationError(`Invalid image type. Must be one of: ${IMAGE_TYPES.join(", ")}`);
    }
    if (imageReadsFromConvex()) {
      const images = await listImagesOnConvex(String(projectId), imageType);
      return images ? actionSuccess(images) : notFoundError("Project");
    }
    // Public projects need no sign-in; a deleted one only its owner or an admin
    if (!(await visibleProject(projectId))) {
      return notFoundError("Project");
    }
    const images = await getProjectImages(projectId, imageType);
    return actionSuccess(images);
  } catch (error) {
    console.error("Error fetching project images:", error);
    return serverError(error, "Failed to fetch images");
  }
}

/**
 * Get cover image for a project the viewer may see
 */
export async function getProjectCoverImageAction(
  projectId: string
): Promise<ActionResult<SelectProjectImage | null>> {
  try {
    if (imageReadsFromConvex()) {
      return actionSuccess(await coverImageOnConvex(String(projectId)));
    }
    if (!(await visibleProject(projectId))) {
      return actionSuccess(null);
    }
    const coverImage = await getProjectCoverImage(projectId);
    return actionSuccess(coverImage);
  } catch (error) {
    console.error("Error fetching cover image:", error);
    return serverError(error, "Failed to fetch cover image");
  }
}

/**
 * Set an image as the cover image
 */
export async function setProjectCoverImageAction(
  imageId: string
): Promise<ActionResult<SelectProjectImage>> {
  try {
    if (imageWritesToConvex()) {
      const updated = await setCoverOnConvex(String(imageId));
      return "success" in updated ? updated : actionSuccess(updated);
    }

    return unauthorizedError("Authentication required to set cover image");
  } catch (error) {
    console.error("Error setting cover image:", error);
    return serverError(error, "Failed to set cover image");
  }
}

/**
 * Delete a project image (soft delete)
 */
export async function deleteProjectImageAction(
  imageId: string
): Promise<ActionResult<boolean>> {
  try {
    if (imageWritesToConvex()) {
      const done = await deleteImageOnConvex(String(imageId), false);
      return done === true ? actionSuccess(true) : done;
    }

    return unauthorizedError("Authentication required to delete images");
  } catch (error) {
    console.error("Error deleting project image:", error);
    return serverError(error, "Failed to delete image");
  }
}

/**
 * Permanently delete a project image (also removes from storage)
 */
export async function permanentlyDeleteProjectImageAction(
  imageId: string
): Promise<ActionResult<{ storagePath: string }>> {
  try {
    // Convex deletes the file itself; the empty path tells the client there is nothing left to delete.
    if (imageWritesToConvex()) {
      const done = await deleteImageOnConvex(String(imageId), true);
      return done === true ? actionSuccess({ storagePath: "" }) : done;
    }

    return unauthorizedError("Authentication required to permanently delete images");
  } catch (error) {
    console.error("Error permanently deleting project image:", error);
    return serverError(error, "Failed to permanently delete image");
  }
}

/**
 * Reorder project images. Only images of this project move (R12).
 */
export async function reorderProjectImagesAction(
  projectId: string,
  imageOrders: { imageId: string; order: number }[]
): Promise<ActionResult<boolean>> {
  try {
    if (imageWritesToConvex()) {
      if (!Array.isArray(imageOrders)) return validationError("Invalid image order");
      const done = await reorderImagesOnConvex(
        String(projectId),
        imageOrders.map((o) => ({ imageId: String(o?.imageId), order: Number(o?.order) }))
      );
      return done === true ? actionSuccess(true) : done;
    }

    return unauthorizedError("Authentication required to reorder images");
  } catch (error) {
    console.error("Error reordering project images:", error);
    return serverError(error, "Failed to reorder images");
  }
}

// updateProjectImageAction (unvalidated .set(), so any column was writable)
// and getImageCountAction had no callers and were removed in D06.
