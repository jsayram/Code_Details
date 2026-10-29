import { Suspense } from "react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { ProjectContent } from "@/components/Projects/ProjectComponents/ProjectContent";
import { notFound, redirect } from "next/navigation";
import { SignedIn, SignedOut } from "@/components/auth/AuthGateServer";
import { LogIn } from "lucide-react";
import {
  SelectProjectWithOwner,
  SelectUserWithProject,
} from "@/db/schema/projects";
import { PageBanner } from "@/components/ui/page-banner";
import { HeaderSectionNoSideBar } from "@/components/layout/HeaderSectionNoSideBar";
import { ProjectsProvider } from "@/providers/projects-provider";
import { cookies } from "next/headers";
import { getProjectReadBackend } from "@/backend/projects";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import { getProjectForViewer } from "@/backend/projects/viewer-read";
import { currentSlugFor, ownProjectForEdit } from "@/backend/projects/owner-edit";
import { routeViewer } from "@/lib/auth-server";
import { chooseAuthBackend } from "@/backend/auth";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: { [key: string]: string | string[] | undefined };
};

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Ensure params is handled as a Promise
  const resolvedParams = await Promise.resolve(params);
  
  // Get auth data first. D04a: through the provider-neutral session helper
  // instead of Clerk's auth(). Under the Better Auth switch this stays null,
  // as Clerk's answer was: the owner gets their own read from
  // ownProjectForEdit and everyone else the public projection.
  const userId =
    chooseAuthBackend().backend === "better-auth" ? null : (await routeViewer())?.userId ?? null;
  
  // Anonymous visitors get the C02 public projection only (no owner email,
  // subject or tier in the page). Signed-in viewers get the session-checked
  // read, scrubbed the same way, except that the owner keeps their own user
  // ID for the edit controls (D02r).
  let project: SelectProjectWithOwner | null;
  let user: SelectUserWithProject | null;
  if (!userId) {
    // D02: under both development switches a Better Auth owner gets their
    // own project with the version the save needs; everyone else, and every
    // other mode, gets the public projection as before.
    const own = await ownProjectForEdit(resolvedParams.slug);
    const publicProject = own ? null : await getProjectReadBackend().getPublicProjectBySlug(resolvedParams.slug);
    ({ project, userProfile: user } = own
      ?? (publicProject ? toProjectContentProps(publicProject) : { project: null, userProfile: null }));
  } else {
    const read = await getProjectForViewer(resolvedParams.slug);
    project = read?.project ?? null;
    user = read?.userProfile ?? null;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get("__supabase_auth_token")?.value || null;

  if (!project) {
    // D02 (P08 R28): an old slug redirects to the current one (Convex read only).
    const moved = await currentSlugFor(resolvedParams.slug);
    if (moved) redirect(`/projects/${moved}`);
    notFound();
  }

  return (
    <SidebarProvider>
      <SignedIn>
        <AppSidebar />
      </SignedIn>
      <SidebarInset>
        <SignedOut>
          <HeaderSectionNoSideBar showMobileMenu={false} />
        </SignedOut>
        <SignedIn>
          <HeaderSection />
        </SignedIn>
        <SignedOut>
          <div className="w-full max-w-[1920px] 4xl:max-w-none mx-auto px-4 2xl:px-8 3xl:px-12 mb-6 py-3">
            <PageBanner
              icon={<LogIn className="h-8 w-8 text-purple-500" />}
              userName={project.owner_full_name || "This creator"}
              bannerTitle={`You are viewing ${
                  project.owner_full_name || "This creator"
                }'s project.`}
              description={`Sign in to explore more of their projects and free content.`}
              isUserBanner={false}
              gradientFrom="purple-900"
              gradientVia="indigo-800"
              gradientTo="violet-800"
              borderColor="border-purple-700/40"
              tierBgColor="bg-purple-700/60"
              textGradient="from-purple-400 via-indigo-400 to-violet-400"
            />
          </div>
        </SignedOut>
        <ProjectsProvider token={token} userId={userId} isLoading={false}>
          <Suspense
            fallback={
              <div className="container mx-auto px-4 py-8">
                <ProjectListLoadingState />
              </div>
            }
          >
            <ProjectContent
              project={project}
              error={undefined}
              userProfile={user}
            />
          </Suspense>
        </ProjectsProvider>
        <FooterSection />
      </SidebarInset>
    </SidebarProvider>
  );
}
