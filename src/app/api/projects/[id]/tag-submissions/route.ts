import { NextRequest } from "next/server";
import { executeQuery } from "@/db/server";
import { tag_submissions } from "@/db/schema/tag_submissions";
import { profiles } from "@/db/schema/profiles";
import { eq, and } from "drizzle-orm";
import { success, invalidInput, databaseError, unauthorized } from "@/lib/api-errors";
import { routeViewer } from "@/lib/auth-server";

const STATUSES = new Set(["pending", "approved", "rejected"]);

// D07 (P08 R04): the viewer's own suggestions only. The ?email= the callers
// send used to pick whose submissions (and admin notes) came back; it is
// ignored now, and the email is the session viewer's profile address.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const projectId = resolvedParams.id;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    if (!STATUSES.has(status)) {
      return invalidInput("Invalid status");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      return invalidInput("Invalid project ID");
    }

    const viewer = await routeViewer();
    if (!viewer) {
      return unauthorized();
    }

    const submissions = await executeQuery(async (db) => {
      const [profile] = await db
        .select({ email: profiles.email_address })
        .from(profiles)
        .where(eq(profiles.user_id, viewer.userId))
        .limit(1);
      if (!profile?.email) return [];
      return db
        .select()
        .from(tag_submissions)
        .where(
          and(
            eq(tag_submissions.project_id, projectId),
            eq(tag_submissions.status, status),
            eq(tag_submissions.submitter_email, profile.email)
          )
        )
        .orderBy(tag_submissions.created_at);
    });

    return success(submissions);
  } catch (error) {
    return databaseError(error, "Failed to fetch tag submissions");
  }
}
