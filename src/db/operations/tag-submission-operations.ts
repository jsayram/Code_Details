// The admin's pending-suggestion list, grouped by tag name. Not a "use server"
// module: callers check the admin first (getPendingTagSubmissions, or
// fetchAdminDashboardData before its cache). D07 moved it here because the
// cached dashboard read ran the session check inside unstable_cache, which
// can't read the request.
import { eq } from "drizzle-orm";
import { executeQuery } from "@/db/server";
import { tag_submissions } from "@/db/schema/tag_submissions";

export async function listPendingTagSubmissions() {
  return executeQuery(async (db) => {
    const submissions = await db
      .select({
        id: tag_submissions.id,
        tag_name: tag_submissions.tag_name,
        project_id: tag_submissions.project_id,
        submitter_email: tag_submissions.submitter_email,
        description: tag_submissions.description,
        status: tag_submissions.status,
        created_at: tag_submissions.created_at,
        updated_at: tag_submissions.updated_at,
        admin_notes: tag_submissions.admin_notes,
        reviewed_at: tag_submissions.reviewed_at
      })
      .from(tag_submissions)
      .where(eq(tag_submissions.status, "pending"))
      .orderBy(tag_submissions.created_at);

    // Group submissions by tag_name
    const groupedSubmissions = submissions.reduce((acc, submission) => {
      const normalizedTagName = submission.tag_name.trim().toLowerCase();
      if (!acc[normalizedTagName]) {
        acc[normalizedTagName] = {
          tag_name: normalizedTagName,
          count: 0,
          submissions: [],
        };
      }
      acc[normalizedTagName].count++;
      acc[normalizedTagName].submissions.push(submission);
      return acc;
    }, {} as Record<string, { tag_name: string; count: number; submissions: typeof submissions }>);

    return Object.values(groupedSubmissions);
  });
}
