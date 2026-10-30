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
import { chooseAuthBackend } from "@/backend/auth";
import { routeViewer } from "@/lib/auth-server";
import { profiles } from "@/db/schema/profiles";
import { getProjectById } from "@/app/actions/projects";
import { listPendingTagSubmissions } from "@/db/operations/tag-submission-operations";
import { projectWritesToConvex } from "@/backend/projects/project-update";
import { moderateOnConvex, pendingSuggestionsOnConvex, suggestTagOnConvex } from "@/backend/projects/tags";

// D07 (P08 R04). Every export here is callable by anyone, so each one checks
// the caller itself. Suggestions come from the signed-in viewer (Clerk backend
// only: under the Better Auth switch alone these Supabase writes refuse, as the
// project, favorite and image writes do), with the viewer's own profile email;
// the email argument callers still pass is ignored. Only the project's owner
// attaches an existing tag directly, within MAX_PROJECT_TAGS; anyone else's
// suggestion stays pending for an admin. Approve and reject are admin-only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in viewer and their profile email, or null. */
async function suggestionViewer(): Promise<{ userId: string; email: string | null } | null> {
  if (chooseAuthBackend().backend !== "clerk") return null;
  const viewer = await routeViewer();
  if (!viewer) return null;
  const [row] = await executeQuery((db) =>
    db.select({ email: profiles.email_address }).from(profiles).where(eq(profiles.user_id, viewer.userId)).limit(1)
  );
  return { userId: viewer.userId, email: row?.email ?? null };
}

/** The project when it exists, isn't deleted and the viewer may see it. */
async function liveProject(projectId: string) {
  if (typeof projectId !== "string" || !UUID_RE.test(projectId)) return null;
  const project = await getProjectById(projectId);
  return project && !project.deleted_at ? project : null;
}

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

  const viewer = await suggestionViewer();
  if (!viewer) {
    return { success: false, error: "You must be signed in to suggest tags" };
  }
  if (!viewer.email) {
    return { success: false, error: "Your profile has no email address" };
  }
  const submitterEmail = viewer.email;

  const project = await liveProject(validationResult.data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }
  const isOwner = project.user_id === viewer.userId;

  return executeQuery(async (db) => {
    const normalizedTagName = validationResult.data.tagName;

    // First check if tag already exists in approved tags (case-insensitive)
    const existingTag = await db
      .select()
      .from(tags)
      .where(eq(tags.name, normalizedTagName))
      .limit(1);

    if (existingTag.length > 0) {
      // Check if the project already has this tag
      const existingProjectTag = await db
        .select()
        .from(project_tags)
        .where(
          and(
            eq(project_tags.project_id, projectId),
            eq(project_tags.tag_id, existingTag[0].id)
          )
        )
        .limit(1);

      // If project already has the tag, just return success without doing anything
      if (existingProjectTag.length > 0) {
        return {
          status: "auto_approved",
          tag_name: normalizedTagName,
          message: "This project already has this tag"
        };
      }

      // The owner adds an existing tag to their own project directly, within
      // the limit. Anyone else's suggestion goes to review below.
      if (isOwner) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(project_tags)
          .where(eq(project_tags.project_id, projectId));
        if (Number(count) >= MAX_PROJECT_TAGS) {
          return { success: false, error: `This project already has the maximum of ${MAX_PROJECT_TAGS} tags` };
        }

        await db
          .insert(project_tags)
          .values({
            project_id: projectId,
            tag_id: existingTag[0].id,
          })
          .onConflictDoNothing();

        // Invalidate caches after auto-approving tag addition
        revalidateTag(CACHE_TAGS.TAGS, {});
        revalidateTag(CACHE_TAGS.PROJECTS, {});
        revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});

        return {
          status: "auto_approved",
          tag_name: normalizedTagName,
          message: "Tag already exists and has been added to your project"
        };
      }
    }

    // Check for any existing submission from the same user for the same project and tag
    const existingSubmission = await db
      .select()
      .from(tag_submissions)
      .where(
        and(
          eq(tag_submissions.project_id, projectId),
          eq(tag_submissions.tag_name, normalizedTagName),
          eq(tag_submissions.submitter_email, submitterEmail)
        )
      )
      .limit(1);

    if (existingSubmission.length > 0) {
      const status = existingSubmission[0].status;
      
      if (status === "pending") {
        throw new Error("You already have a pending submission for this tag");
      } else if (status === "approved") {
        throw new Error("This tag has already been approved for this project");
      }
      // Note: We don't block rejected submissions here because the tag might have been
      // approved by another user since the rejection. The check at the top of this function
      // will auto-approve if the tag now exists in the tags table.
    }

    // Create new tag submission for review
    const [submission] = await db
      .insert(tag_submissions)
      .values({
        tag_name: normalizedTagName,
        project_id: projectId,
        submitter_email: submitterEmail,
        description: validationResult.data.description?.trim(),
      })
      .returning();

    return {
      ...submission,
      status: "pending"
    };
  });
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
// mark their own rejected suggestion approved. Owner only, own email (D07).
export async function approveRejectedTagSubmission(
  projectId: string,
  tagName: string,
  // Ignored (D07): the submitter is the session's viewer.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _submitterEmail?: string
) {
  if (typeof tagName !== "string" || !tagName.trim() || tagName.length > 100) return;
  // Convex keeps a rejected suggestion as it was; the owner's save adds the tag.
  if (projectWritesToConvex()) return;
  const viewer = await suggestionViewer();
  if (!viewer?.email) return;
  const project = await liveProject(projectId);
  if (!project || project.user_id !== viewer.userId) return;
  const submitterEmail = viewer.email;

  return executeQuery(async (db) => {
    const normalizedTagName = tagName.trim().toLowerCase();

    // Update the rejected submission to approved status
    await db
      .update(tag_submissions)
      .set({
        status: "approved",
        reviewed_at: new Date(),
        admin_notes: "Auto-approved: Tag was added to project after becoming available system-wide",
      })
      .where(
        and(
          eq(tag_submissions.project_id, projectId),
          eq(tag_submissions.tag_name, normalizedTagName),
          eq(tag_submissions.submitter_email, submitterEmail),
          eq(tag_submissions.status, "rejected")
        )
      );

    // Revalidate relevant caches and paths
    revalidateTag(CACHE_TAGS.TAGS, {});
    revalidateTag(CACHE_TAGS.PROJECTS, {});
    revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
    revalidatePath("/administrator/dashboard");
    revalidatePath("/dashboard");
    revalidatePath(`/projects/${projectId}`);
  });
}

function revalidateAfterModeration() {
  revalidateTag(CACHE_TAGS.TAGS, {});
  revalidateTag(CACHE_TAGS.PROJECTS, {});
  revalidateTag(CACHE_TAGS.PROJECT_DETAIL, {});
  revalidateTag(CACHE_TAGS.ADMIN_DASHBOARD, {});
  revalidateTag(CACHE_TAGS.TAG_SUBMISSIONS, {});
  revalidatePath("/dashboard/tag-submissions");
}
