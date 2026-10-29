import { NextRequest } from "next/server";
import { getProjectForViewer } from "@/backend/projects/viewer-read";
import { success, notFound, databaseError } from "@/lib/api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const resolvedParams = await params;
    
    // D02r: the viewer comes from the session inside getProjectForViewer, and
    // the project comes back without the owner's email, tier or profile ID.
    const read = await getProjectForViewer(resolvedParams.slug);

    if (!read) {
      return notFound("project", { identifier: resolvedParams.slug, identifierType: "slug" });
    }

    return success(read.project);
  } catch (error) {
    return databaseError(error, "Failed to fetch project");
  }
}
