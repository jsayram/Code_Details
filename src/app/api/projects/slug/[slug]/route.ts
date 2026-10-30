import { NextRequest } from "next/server";
import { getProjectForViewer } from "@/backend/projects/viewer-read";
import { success, notFound, databaseError } from "@/lib/api-errors";
import { chooseAuthBackend } from "@/backend/auth";
import { getProjectReadBackend } from "@/backend/projects";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import { ownProjectForEdit } from "@/backend/projects/owner-edit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const resolvedParams = await params;

    // D07-c: under the Better Auth switch, the same read as the project page
    // (the owner's own project, else the public projection), so the IDs match
    // the backend the page and the writes use (Convex IDs under both switches).
    if (chooseAuthBackend().backend === "better-auth") {
      const own = await ownProjectForEdit(resolvedParams.slug);
      const publicProject = own ? null : await getProjectReadBackend().getPublicProjectBySlug(resolvedParams.slug);
      const project = own?.project ?? (publicProject ? toProjectContentProps(publicProject).project : null);
      if (!project) {
        return notFound("project", { identifier: resolvedParams.slug, identifierType: "slug" });
      }
      return success(project);
    }

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
