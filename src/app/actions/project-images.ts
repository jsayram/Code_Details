"use server";

/**
 * Project Images Server Actions
 * RFC 7807 compliant server actions for managing project images
 */

import {
  createProjectImage,
  getProjectImages,
  getProjectCoverImage,
  getProjectImageByType,
  getProjectImageById,
  updateProjectImage,
  softDeleteProjectImage,
  permanentlyDeleteProjectImage,
  reorderProjectImages,
  countProjectImagesByType,
} from "@/db/operations/project-image-operations";
import { getProjectById } from "@/app/actions/projects";
import {
  InsertProjectImage,
  SelectProjectImage,
  ImageType,
  IMAGE_TYPES,
  ASPECT_RATIOS,
  AspectRatio,
} from "@/db/schema/project_images";
import {
  type ActionResult,
  actionSuccess,
  unauthorizedError,
  notFoundError,
  validationError,
  serverError,
  forbiddenError,
} from "@/lib/action-errors";
import { chooseAuthBackend } from "@/backend/auth";
import { routeViewer } from "@/lib/auth-server";
import { ALLOWED_IMAGE_TYPES, PROJECT_IMAGE_LIMITS } from "@/constants/project-limits";
import {
  deleteProjectImage as deleteFromStorage,
  getProjectImageUrl,
} from "@/lib/supabase-storage";

// =============================================================================
// Types
// =============================================================================

export interface ImageUploadInput {
  projectId: string;
  storagePath: string;
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
// Image Limits by Type
// =============================================================================

const IMAGE_LIMITS: Record<ImageType, number> = {
  cover: 1, // Only 1 cover image allowed
  screenshot: 20, // Up to 20 screenshots
  diagram: 10, // Up to 10 diagrams
  logo: 1, // Only 1 logo
};

// =============================================================================
// Helper Functions
// =============================================================================

// D06 (P08 R02/R11/R12/R33). Writers come from the session, Clerk backend only:
// under the Better Auth switch alone these Supabase writes refuse, as the
// project and favorite writes do (D03, D05). Reads go through getProjectById,
// which hides a soft-deleted project from everyone but its owner and admins.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The uploader's own format (generateStoragePath): <uuid>-<sanitized name, at most 50>.
const STORAGE_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,50}$/;
const MAX_FILE_NAME = 255;
const MAX_TEXT = 1000;
const MAX_DIMENSION = 20000;

async function imageWriter(): Promise<string | null> {
  if (chooseAuthBackend().backend !== "clerk") return null;
  return (await routeViewer())?.userId ?? null;
}

/**
 * The project when the viewer may see it (getProjectById's rule), else null.
 */
async function visibleProject(projectId: string) {
  if (typeof projectId !== "string" || !UUID_RE.test(projectId)) return null;
  return getProjectById(projectId);
}

/**
 * Verify user owns the project. A soft-deleted project takes no new or
 * reordered images; its owner can still delete them (`allowDeleted`).
 */
async function verifyProjectOwnership(
  projectId: string,
  userId: string,
  { allowDeleted = false } = {}
): Promise<{ owned: boolean; project?: Awaited<ReturnType<typeof getProjectById>> }> {
  const project = await visibleProject(projectId);

  if (!project || (project.deleted_at && !allowDeleted)) {
    return { owned: false };
  }

  return {
    owned: project.user_id === userId,
    project,
  };
}

async function imageById(imageId: string) {
  if (typeof imageId !== "string" || !UUID_RE.test(imageId)) return null;
  return getProjectImageById(imageId);
}

const optionalInt = (v: unknown, max: number) =>
  v === undefined || v === null || (Number.isInteger(v) && (v as number) > 0 && (v as number) <= max);
const optionalText = (v: unknown, max: number) =>
  v === undefined || v === null || (typeof v === "string" && v.length <= max);

/**
 * The checks a registration must pass before it is written. The size and type
 * are the browser's claims (the bytes go straight to the bucket, R10); the path
 * must be one the caller's own uploader made for this project, so nobody can
 * register, and later delete, someone else's file (R11).
 */
function uploadInputError(input: ImageUploadInput, userId: string): string | null {
  if (!IMAGE_TYPES.includes(input.imageType)) {
    return `Invalid image type. Must be one of: ${IMAGE_TYPES.join(", ")}`;
  }
  const prefix = `${userId}/${input.projectId}/`;
  if (
    typeof input.storagePath !== "string" ||
    !input.storagePath.startsWith(prefix) ||
    !STORAGE_FILE_RE.test(input.storagePath.slice(prefix.length))
  ) {
    return "Invalid storage path";
  }
  if (typeof input.fileName !== "string" || !input.fileName || input.fileName.length > MAX_FILE_NAME) {
    return "Invalid file name";
  }
  if (
    typeof input.mimeType !== "string" ||
    !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.mimeType)
  ) {
    return `Invalid file type. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`;
  }
  if (!Number.isInteger(input.fileSize) || input.fileSize! <= 0 || input.fileSize! > PROJECT_IMAGE_LIMITS.MAX_FILE_SIZE_BYTES) {
    return `File too large. Maximum size is ${PROJECT_IMAGE_LIMITS.MAX_FILE_SIZE_MB}MB`;
  }
  if (!optionalInt(input.width, MAX_DIMENSION) || !optionalInt(input.height, MAX_DIMENSION)) {
    return "Invalid image dimensions";
  }
  if (input.aspectRatio !== undefined && !ASPECT_RATIOS.includes(input.aspectRatio)) {
    return `Invalid aspect ratio. Must be one of: ${ASPECT_RATIOS.join(", ")}`;
  }
  if (!optionalText(input.altText, MAX_TEXT) || !optionalText(input.caption, MAX_TEXT)) {
    return "Alt text and caption are limited to 1000 characters";
  }
  return null;
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Create a new project image record after upload
 */
export async function createProjectImageAction(
  input: ImageUploadInput
): Promise<ActionResult<SelectProjectImage>> {
  try {
    const userId = await imageWriter();

    if (!userId) {
      return unauthorizedError("Authentication required to upload images");
    }

    if (!input || typeof input !== "object") {
      return validationError("Invalid image");
    }

    // Verify project ownership
    const { owned, project } = await verifyProjectOwnership(input.projectId, userId);

    if (!project) {
      return notFoundError("Project");
    }

    if (!owned) {
      return forbiddenError("You do not have permission to add images to this project");
    }

    const inputError = uploadInputError(input, userId);
    if (inputError) {
      return validationError(inputError);
    }

    // Check image count limit
    const currentCount = await countProjectImagesByType(input.projectId, input.imageType);
    const limit = IMAGE_LIMITS[input.imageType];

    // For cover and logo, auto-replace the existing image of the same kind (R33)
    if ((input.imageType === "cover" || input.imageType === "logo") && currentCount >= limit) {
      const existingImage = await getProjectImageByType(input.projectId, input.imageType);
      if (existingImage) {
        // Delete from storage first
        await deleteFromStorage(existingImage.storage_path);
        // Then delete from database
        await permanentlyDeleteProjectImage(existingImage.id);
      }
    } else if (currentCount >= limit) {
      return validationError(
        `Maximum ${limit} ${input.imageType} image(s) allowed. Please delete an existing image first.`
      );
    }

    // Only the checked fields reach the insert; the URL comes from the path.
    const imageData: InsertProjectImage = {
      project_id: input.projectId,
      storage_path: input.storagePath,
      storage_url: getProjectImageUrl(input.storagePath),
      file_name: input.fileName,
      file_size: input.fileSize ?? null,
      mime_type: input.mimeType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      image_type: input.imageType,
      aspect_ratio: input.aspectRatio ?? "auto",
      alt_text: input.altText ?? null,
      caption: input.caption ?? null,
      uploaded_by: userId,
      display_order: currentCount, // Add at end
    };

    const image = await createProjectImage(imageData);

    return actionSuccess(image);
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
    const userId = await imageWriter();

    if (!userId) {
      return unauthorizedError("Authentication required to set cover image");
    }

    // Get the image
    const image = await imageById(imageId);

    if (!image || image.deleted_at) {
      return notFoundError("Image");
    }

    // Verify ownership
    const { owned } = await verifyProjectOwnership(image.project_id, userId);

    if (!owned) {
      return forbiddenError("You do not have permission to set cover image");
    }

    // Get existing cover and demote it
    const existingCover = await getProjectCoverImage(image.project_id);
    if (existingCover && existingCover.id !== image.id) {
      await updateProjectImage(existingCover.id, { image_type: "screenshot" });
    }

    // Set new cover
    const updatedImage = await updateProjectImage(image.id, { image_type: "cover" });

    return actionSuccess(updatedImage);
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
    const userId = await imageWriter();

    if (!userId) {
      return unauthorizedError("Authentication required to delete images");
    }

    // Get the image
    const image = await imageById(imageId);

    if (!image) {
      return notFoundError("Image");
    }

    // Verify ownership
    const { owned } = await verifyProjectOwnership(image.project_id, userId, { allowDeleted: true });

    if (!owned) {
      return forbiddenError("You do not have permission to delete this image");
    }

    await softDeleteProjectImage(image.id);

    return actionSuccess(true);
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
    const userId = await imageWriter();

    if (!userId) {
      return unauthorizedError("Authentication required to permanently delete images");
    }

    // Get the image
    const image = await imageById(imageId);

    if (!image) {
      return notFoundError("Image");
    }

    // Verify ownership
    const { owned } = await verifyProjectOwnership(image.project_id, userId, { allowDeleted: true });

    if (!owned) {
      return forbiddenError("You do not have permission to permanently delete this image");
    }

    // Store path before deletion for cleanup
    const storagePath = image.storage_path;

    await permanentlyDeleteProjectImage(image.id);

    // Return the storage path so caller can delete from storage (R13: the
    // browser still does this on the default path; Convex deletes server-side)
    return actionSuccess({ storagePath });
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
    const userId = await imageWriter();

    if (!userId) {
      return unauthorizedError("Authentication required to reorder images");
    }

    if (
      !Array.isArray(imageOrders) ||
      imageOrders.length > PROJECT_IMAGE_LIMITS.MAX_TOTAL_IMAGES * 4 ||
      !imageOrders.every(
        (o) =>
          o &&
          typeof o.imageId === "string" &&
          UUID_RE.test(o.imageId) &&
          Number.isInteger(o.order) &&
          o.order >= 0 &&
          o.order <= 1000
      )
    ) {
      return validationError("Invalid image order");
    }

    // Verify ownership
    const { owned } = await verifyProjectOwnership(projectId, userId);

    if (!owned) {
      return forbiddenError("You do not have permission to reorder images for this project");
    }

    await reorderProjectImages(
      projectId,
      imageOrders.map(({ imageId, order }) => ({ imageId, order }))
    );

    return actionSuccess(true);
  } catch (error) {
    console.error("Error reordering project images:", error);
    return serverError(error, "Failed to reorder images");
  }
}

// updateProjectImageAction (unvalidated .set(), so any column was writable)
// and getImageCountAction had no callers and were removed in D06.
