import { NextRequest } from "next/server";
import { success, invalidInput, databaseError, serverError, unauthorized } from "@/lib/api-errors";
import { betterAuthSignedIn } from "@/lib/auth-server";
import { DATA_UNAVAILABLE, personalReadsFromConvex } from "@/backend/projects/personal";
import { mySuggestionsOnConvex } from "@/backend/projects/tags";

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
    // D07-c: the viewer's own Convex suggestions. E03: the Supabase read is gone.
    if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);
    if (projectId.length > 64) return invalidInput("Invalid project ID");
    if (!(await betterAuthSignedIn())) return unauthorized();
    return success(await mySuggestionsOnConvex(projectId, status));
  } catch (error) {
    return databaseError(error, "Failed to fetch tag submissions");
  }
}
