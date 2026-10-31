"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { MAX_ADMIN_NOTES_LENGTH } from "@/constants/project-limits";
import { z } from "zod";
import { tagNameSchema, tagDescriptionSchema } from "@/types/schemas";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { requireAdminForAction } from "@/lib/admin-action";
import { projectWritesToConvex } from "@/backend/projects/project-update";
import { requireConvexData } from "@/backend/projects/personal";
import { moderateOnConvex, pendingSuggestionsOnConvex, suggestTagOnConvex } from "@/backend/projects/tags";

// D07 (P08 R04). Every export here is callable by anyone, so each one checks
// the caller itself. Suggestions come from the signed-in viewer and go to
// Convex (D07-c); D08g4f2: the Clerk-keyed Supabase suggestion is gone, so
// anything else refuses, as the project, favorite and image writes do. The
// email argument callers still pass is ignored. Approve and reject are
// admin-only. E03: the Supabase pending list and moderation are gone too.

// Schema for submitNewTag input validation
const submitNewTagSchema = z.object({
  tagName: tagNameSchema,
  // A Convex ID (checked by Convex).
  projectId: z.string().min(1).max(64),
  description: tagDescriptionSchema,
});

export async function submitNewTag(
  tagName: string,
  projectId: string,
  // Ignored (D07): the submitter is the session's viewer.
  _submitterEmail?: string,
  description?: string
) {
  // Validate input with Zod schema
  const validationResult = submitNewTagSchema.safeParse({
    tagName,
    projectId,
    description,
  });

  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    return { success: false, error: firstError.message };
  }

  // D07-c: under both development switches the suggestion goes to Convex.
  if (projectWritesToConvex()) {
    return suggestTagOnConvex(projectId, validationResult.data.tagName, validationResult.data.description?.trim());
  }

  // D08g4f2: the Clerk-keyed Supabase suggestion is gone.
  return { success: false, error: "You must be signed in to suggest tags" };
}

// SEC-D04-DASH: an export of this "use server" file is callable by anyone, and
// this returned every submitter's email. Admins only.
export async function getPendingTagSubmissions() {
  await requireAdminForAction();
  requireConvexData();
  return pendingSuggestionsOnConvex();
}

// Schema for approveTagSubmission input validation
const submissionIdSchema = z
  .string()
  .refine((id) => id.length > 0 && id.length <= 64, "Invalid submission ID format");

const approveTagSubmissionSchema = z.object({
  submissionId: submissionIdSchema,
  adminNotes: z.string().max(MAX_ADMIN_NOTES_LENGTH, `Admin notes must be at most ${MAX_ADMIN_NOTES_LENGTH} characters`).optional(),
  approvalType: z.enum(["system", "project"]).default("project"),
});

export async function approveTagSubmission(
  submissionId: string, 
  adminNotes?: string,
  approvalType: "system" | "project" = "project"
) {
  await requireAdminForAction();

  // Validate input with Zod schema
  const validationResult = approveTagSubmissionSchema.safeParse({
    submissionId,
    adminNotes,
    approvalType,
  });

  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    return { success: false, error: firstError.message };
  }

  const validated = validationResult.data;

  requireConvexData();
  await moderateOnConvex("approve", validated.submissionId, validated.adminNotes, validated.approvalType);
  revalidateAfterModeration();
}

const rejectTagSubmissionSchema = z.object({
  submissionId: submissionIdSchema,
  adminNotes: z.string().max(MAX_ADMIN_NOTES_LENGTH, `Admin notes must be at most ${MAX_ADMIN_NOTES_LENGTH} characters`).optional(),
});

export async function rejectTagSubmission(submissionId: string, adminNotes: string) {
  await requireAdminForAction();

  const validationResult = rejectTagSubmissionSchema.safeParse({ submissionId, adminNotes });
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }
  const validated = validationResult.data;

  requireConvexData();
  await moderateOnConvex("reject", validated.submissionId, validated.adminNotes);
  revalidateAfterModeration();
}

function revalidateAfterModeration() {
  revalidateTag(CACHE_TAGS.TAGS, {});
  revalidateTag(CACHE_TAGS.PROJECTS, {});
  revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
  revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
  revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
  revalidatePath("/dashboard/tag-submissions");
}
