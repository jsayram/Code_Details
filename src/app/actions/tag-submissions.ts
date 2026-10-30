"use server";

import { executeQuery } from "@/db/server";
import { tag_submissions } from "@/db/schema/tag_submissions";
import { tags } from "@/db/schema/tags";
import { project_tags } from "@/db/schema/project_tags";
import { eq, and, not } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { sql } from "drizzle-orm/sql";
import { MAX_PROJECT_TAGS, MAX_ADMIN_NOTES_LENGTH } from "@/constants/project-limits";
import { z } from "zod";
import { tagNameSchema, tagDescriptionSchema } from "@/types/schemas";
import { CACHE_TAGS } from "@/lib/swr-fetchers";
import { requireAdminForAction } from "@/lib/admin-action";
import { listPendingTagSubmissions } from "@/db/operations/tag-submission-operations";
import { projectWritesToConvex } from "@/backend/projects/project-update";
import { moderateOnConvex, pendingSuggestionsOnConvex, suggestTagOnConvex } from "@/backend/projects/tags";

// D07 (P08 R04). Every export here is callable by anyone, so each one checks
// the caller itself. Suggestions come from the signed-in viewer and go to
// Convex (D07-c); D08g4f2: the Clerk-keyed Supabase suggestion is gone, so
// anything else refuses, as the project, favorite and image writes do. The
// email argument callers still pass is ignored. Approve and reject are
// admin-only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Schema for submitNewTag input validation
const submitNewTagSchema = z.object({
  tagName: tagNameSchema,
  // A UUID on Supabase, a Convex ID under the switches (checked by Convex).
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
  if (projectWritesToConvex()) return pendingSuggestionsOnConvex();
  return listPendingTagSubmissions();
}

// Schema for approveTagSubmission input validation
const submissionIdSchema = z
  .string()
  .refine((id) => (projectWritesToConvex() ? id.length > 0 && id.length <= 64 : UUID_RE.test(id)), "Invalid submission ID format");

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

  if (projectWritesToConvex()) {
    await moderateOnConvex("approve", validated.submissionId, validated.adminNotes, validated.approvalType);
    revalidateAfterModeration();
    return;
  }

  return executeQuery(async (db) => {
    // Get the submission
    const [submission] = await db
      .select()
      .from(tag_submissions)
      .where(eq(tag_submissions.id, validated.submissionId));

    if (!submission) throw new Error("Submission not found");

    // Count current project tags only if we're approving for the project
    if (validated.approvalType === "project") {
      if (!submission.project_id) {
        throw new Error("Cannot approve tag for project - submission has no project_id");
      }
      
      const currentProjectTags = await db
        .select({ count: sql<number>`count(*)` })
        .from(project_tags)
        .where(eq(project_tags.project_id, submission.project_id));

      const currentTagCount = Number(currentProjectTags[0]?.count) || 0;

      if (currentTagCount >= MAX_PROJECT_TAGS) {
        throw new Error(`Cannot approve tag for project - project already has the maximum of ${MAX_PROJECT_TAGS} tags`);
      }
    }

    // Create or get the tag
    let tagId: string;
    const existingTag = await db
      .select()
      .from(tags)
      .where(eq(tags.name, submission.tag_name.trim()))
      .limit(1);

    if (existingTag.length > 0) {
      tagId = existingTag[0].id;
    } else {
      const [newTag] = await db
        .insert(tags)
        .values({
          name: submission.tag_name.trim(),
        })
        .returning();
      tagId = newTag.id;
    }

    // Check if the project already has this specific tag
    let existingProjectTag: { project_id: string; tag_id: string }[] = [];
    if (submission.project_id) {
      existingProjectTag = await db
        .select()
        .from(project_tags)
        .where(
          and(
            eq(project_tags.project_id, submission.project_id),
            eq(project_tags.tag_id, tagId)
          )
        )
        .limit(1);
    }

    // Begin collecting updates
    const updates = [];

    // Update the original submission
    updates.push(
      db
        .update(tag_submissions)
        .set({
          status: "approved",
          admin_notes: validated.adminNotes || (validated.approvalType === "system" 
            ? "Approved for system-wide use only" 
            : "Approved for system and project"),
          reviewed_at: new Date(),
        })
        .where(eq(tag_submissions.id, validated.submissionId))
    );

    // Only create project-tag association if approving for project AND it doesn't exist
    if (validated.approvalType === "project" && submission.project_id && existingProjectTag.length === 0) {
      updates.push(
        db.insert(project_tags).values({
          project_id: submission.project_id,
          tag_id: tagId,
        })
      );
    }

    // Find all other pending submissions for the same tag
    const otherPendingSubmissions = await db
      .select()
      .from(tag_submissions)
      .where(
        and(
          eq(tag_submissions.tag_name, submission.tag_name.trim()),
          eq(tag_submissions.status, "pending"),
          not(eq(tag_submissions.id, validated.submissionId))
        )
      );

    // Update other pending submissions for the same tag
    for (const pendingSubmission of otherPendingSubmissions) {
      // Only count tags if the submission has a project_id
      if (!pendingSubmission.project_id) {
        // Auto-approve system-wide tag submissions without a project
        updates.push(
          db
            .update(tag_submissions)
            .set({
              status: "approved",
              admin_notes: "Auto-approved - tag approved for system-wide use",
              reviewed_at: new Date(),
            })
            .where(eq(tag_submissions.id, pendingSubmission.id))
        );
        continue;
      }
      
      // Count tags for this project
      const projectTags = await db
        .select({ count: sql<number>`count(*)` })
        .from(project_tags)
        .where(eq(project_tags.project_id, pendingSubmission.project_id));

      const tagCount = Number(projectTags[0]?.count) || 0;

      if (tagCount >= MAX_PROJECT_TAGS) {
        // Update submission as rejected with explanation
        updates.push(
          db
            .update(tag_submissions)
            .set({
              status: "rejected",
              admin_notes: `Could not auto-approve - project already has the maximum of ${MAX_PROJECT_TAGS} tags`,
              reviewed_at: new Date(),
            })
            .where(eq(tag_submissions.id, pendingSubmission.id))
        );
        continue;
      }

      // Check if this project already has the tag
      const existingPendingProjectTag = await db
        .select()
        .from(project_tags)
        .where(
          and(
            eq(project_tags.project_id, pendingSubmission.project_id),
            eq(project_tags.tag_id, tagId)
          )
        )
        .limit(1);

      if (existingPendingProjectTag.length === 0) {
        updates.push(
          db
            .update(tag_submissions)
            .set({
              status: "approved",
              admin_notes: "Automatically approved as tag was approved for another submission",
              reviewed_at: new Date(),
            })
            .where(eq(tag_submissions.id, pendingSubmission.id))
        );

        updates.push(
          db.insert(project_tags).values({
            project_id: pendingSubmission.project_id,
            tag_id: tagId,
          })
        );
      }
    }

    // Execute all updates
    await Promise.all(updates);

    // Force clear ALL tag-related caches with revalidateTag
    revalidateTag(CACHE_TAGS.TAGS, {});
    revalidateTag(CACHE_TAGS.PROJECTS, {});
    revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
    revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
    revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
    
    // Also revalidate paths for immediate page updates
    revalidatePath("/projects", "layout");
    revalidatePath("/administrator/dashboard", "layout");
    revalidatePath("/api/tags", "layout");
    revalidatePath("/api/projects", "layout");
    revalidatePath(`/projects/${submission.project_id}`, "layout");
    revalidatePath("/", "layout");  // Revalidate homepage which might show projects
    revalidatePath("/tags", "layout"); // Revalidate tags page
    revalidatePath(`/api/projects/${submission.project_id}`, "layout"); // Revalidate project API endpoint
  });
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

  if (projectWritesToConvex()) {
    await moderateOnConvex("reject", validated.submissionId, validated.adminNotes);
    revalidateAfterModeration();
    return;
  }

  return executeQuery(async (db) => {
    await db
      .update(tag_submissions)
      .set({
        status: "rejected",
        admin_notes: validated.adminNotes,
        reviewed_at: new Date(),
      })
      .where(eq(tag_submissions.id, validated.submissionId));

    revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
    revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
    revalidatePath("/administrator/dashboard");
  });
}

// After the owner saves a tag that came from a rejected suggestion's link,
// this marked their own rejected Supabase suggestion approved. Convex keeps a
// rejected suggestion as it was (the owner's save adds the tag), and D08g4f2
// removed the Clerk-keyed Supabase update, so it does nothing. Kept so the
// callers don't change; E03 can remove it with them.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function approveRejectedTagSubmission(
  _projectId: string,
  _tagName: string,
  _submitterEmail?: string
): Promise<void> {}
/* eslint-enable @typescript-eslint/no-unused-vars */

function revalidateAfterModeration() {
  revalidateTag(CACHE_TAGS.TAGS, {});
  revalidateTag(CACHE_TAGS.PROJECTS, {});
  revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
  revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
  revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
  revalidatePath("/dashboard/tag-submissions");
}
