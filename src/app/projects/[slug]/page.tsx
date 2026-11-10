import "@/styles/foundations.css";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ProjectContent } from "@/components/Projects/ProjectComponents/ProjectContent";
import { notFound, redirect } from "next/navigation";
import { SignedOut } from "@/components/auth/AuthGateServer";
import { SelectProjectWithOwner, SelectUserWithProject } from "@/types/rows";
import { ProjectsProvider } from "@/providers/projects-provider";
import { getProjectReadBackend } from "@/backend/projects";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import { currentSlugFor, ownProjectForEdit } from "@/backend/projects/owner-edit";
import { ProjectPageSkeleton } from "./project-page-skeleton";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Ensure params is handled as a Promise
  const resolvedParams = await Promise.resolve(params);

  // D02: a Better Auth owner gets their own project with the version the save
  // needs; everyone else gets the C02 public projection (no owner email,
  // subject or tier in the page). D08g4i: the Clerk-era signed-in read
  // (routeViewer, then getProjectForViewer) is gone from this page; with Better
  // Auth it never ran.
  let project: SelectProjectWithOwner | null;
  let user: SelectUserWithProject | null;
  {
    const own = await ownProjectForEdit(resolvedParams.slug);
    const publicProject = own ? null : await getProjectReadBackend().getPublicProjectBySlug(resolvedParams.slug);
    ({ project, userProfile: user } = own
      ?? (publicProject ? toProjectContentProps(publicProject) : { project: null, userProfile: null }));
  }

  if (!project) {
    // D02 (P08 R28): an old slug redirects to the current one (Convex read only).
    const moved = await currentSlugFor(resolvedParams.slug);
    if (moved) redirect(`/projects/${moved}`);
    notFound();
  }

  const ownerName = project.owner_full_name || "This creator";

  // UI06.2: on the shared AppShell for everyone. Signed out, the sidebar shows
  // only its public entries (UI05), and a quiet note replaces the old banner.
  return (
    <AppShell>
      <SignedOut>
        <div className="cd-foundations" style={{ background: "var(--cd-bg)" }}>
          <div className="cd-page" style={{ paddingBlockEnd: 0 }}>
            <p className="cd-surface cd-small cd-wrap" role="note">
              <span className="font-medium">You are viewing {ownerName}&apos;s project.</span>{" "}
              <span className="cd-muted">Sign in to explore more of their projects and free content.</span>
            </p>
          </div>
        </div>
      </SignedOut>
      <ProjectsProvider userId={null} isLoading={false}>
        <Suspense fallback={<ProjectPageSkeleton />}>
          <ProjectContent
            project={project}
            error={undefined}
            userProfile={user}
          />
        </Suspense>
      </ProjectsProvider>
    </AppShell>
  );
}
