// The project read for signed-in viewers (D02r). The viewer comes from the
// session (routeViewer), never from an argument, and what reaches the page or
// the JSON is scrubbed (P08 R07, P07 §8): no owner email, tier or profile
// UUID for anyone, and the owner's user ID only for the owner themself,
// because ProjectContent compares it with the signed-in user to show the edit
// controls. Server-side only; not a "use server" module.
import type { SelectProjectWithOwner, SelectUserWithProject } from "@/db/schema/projects";
import { readProjectBySlug, readProjectOwnerProfileBySlug, type ProjectViewer } from "@/db/project-read";
import { routeViewer } from "@/lib/auth-server";

export function scrubProjectForViewer(
  project: SelectProjectWithOwner,
  viewer: ProjectViewer,
): SelectProjectWithOwner {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { owner_email_address, owner_tier, owner_id, owner_user_id, user_id, ...rest } = project;
  if (viewer && user_id === viewer.userId) {
    return { ...rest, user_id, owner_user_id } as SelectProjectWithOwner;
  }
  return rest as SelectProjectWithOwner;
}

export function scrubOwnerProfileForViewer(
  profile: SelectUserWithProject,
  viewer: ProjectViewer,
): SelectUserWithProject {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { email_address, tier, id, user_id, ...rest } = profile;
  if (viewer && user_id === viewer.userId) {
    return { ...rest, user_id } as SelectUserWithProject;
  }
  return rest as SelectUserWithProject;
}

/** The project by slug for the session's viewer, scrubbed; null when not visible. */
export async function getProjectForViewer(
  slug: string,
): Promise<{ project: SelectProjectWithOwner; userProfile: SelectUserWithProject | null } | null> {
  const viewer = await routeViewer();
  const project = (await readProjectBySlug(slug, viewer)) as SelectProjectWithOwner | null;
  if (!project) return null;
  const profile = await readProjectOwnerProfileBySlug(slug);
  return {
    project: scrubProjectForViewer(project, viewer),
    userProfile: profile ? scrubOwnerProfileForViewer(profile, viewer) : null,
  };
}
