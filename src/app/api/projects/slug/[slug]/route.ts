import { NextRequest } from "next/server";
import { success, notFound, databaseError, serverError } from "@/lib/api-errors";
import { getProjectReadBackend } from "@/backend/projects";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import { ownProjectForEdit } from "@/backend/projects/owner-edit";
import { DATA_UNAVAILABLE, personalReadsFromConvex } from "@/backend/projects/personal";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const resolvedParams = await params;

    // D07-c: the same read as the project page (the owner's own project,
    // else the public projection), so the IDs match the backend the page and
    // the writes use. E03: no Supabase fallback.
    if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);
    const own = await ownProjectForEdit(resolvedParams.slug);
    const publicProject = own ? null : await getProjectReadBackend().getPublicProjectBySlug(resolvedParams.slug);
    const project = own?.project ?? (publicProject ? toProjectContentProps(publicProject).project : null);
    if (!project) {
      return notFound("project", { identifier: resolvedParams.slug, identifierType: "slug" });
    }
    return success(project);
  } catch (error) {
    return databaseError(error, "Failed to fetch project");
  }
}
