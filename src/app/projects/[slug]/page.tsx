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
import { SelectProjectWithOwner, SelectUserWithProject } from "@/types/rows";
import { PageBanner } from "@/components/ui/page-banner";
import { HeaderSectionNoSideBar } from "@/components/layout/HeaderSectionNoSideBar";
import { ProjectsProvider } from "@/providers/projects-provider";
import { getProjectReadBackend } from "@/backend/projects";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import { currentSlugFor, ownProjectForEdit } from "@/backend/projects/owner-edit";

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
        <ProjectsProvider userId={null} isLoading={false}>
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
