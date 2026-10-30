"use client";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSupabaseToken } from "@/hooks/use-SupabaseClerkJWTToken";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { useDisplayUser } from "@/components/auth/useDisplayUser";
import { ProjectsProvider } from "@/providers/projects-provider";
import { ProjectList } from "@/components/Projects";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import ProtectedPage from "@/app/auth/ProtectedPage";
import { PROTECTED_PAGES_TIERS } from "@/app/auth/protectedPageConstants";
import { useUserTier } from "@/hooks/use-user-tier";
import { useState } from "react";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import { PageBanner } from "@/components/ui/page-banner";
import { GemIcon } from "lucide-react";

export default function MyProjectsShowcase() {
  const { token, loading: tokenLoading } = useSupabaseToken();
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);

  // D02r-c: Clerk's values by default; the Better Auth session under the switch.
  const viewer = usePersonalPageViewer({ token, tokenLoading });
  // D04f: keyed on the session's viewer (Clerk's ID, or the Better Auth
  // session's under the switch); the route reads the tier from the session.
  const { userTier } = useUserTier(viewer.userId);
  const { user: displayUser } = useDisplayUser();

  // Determine overall loading state
  const isLoading = viewer.isLoading;

  return (
    <>
      {isLoading ? (
        <div className="flex justify-center w-full mb-20">
          <div className="w-full px-4 2xl:px-8 3xl:px-12">
            <div className="flex flex-col gap-4 mb-6 py-3">
              <ProjectListLoadingState />
            </div>
          </div>
        </div>
      ) : (
        <ProjectsProvider
          token={viewer.token}
          userId={viewer.userId}
          isLoading={isLoading}
        >
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <HeaderSection />
              <ProtectedPage allowedTiers={PROTECTED_PAGES_TIERS}>
                <div className="flex justify-center w-full mb-20">
                  <div className="w-full px-4 2xl:px-8 3xl:px-12">
                    <div className="flex flex-col gap-4 mb-6 py-3">
                      <div className="mb-8">
                        <div className="flex flex-col space-y-4">
                          <PageBanner
                            icon={
                              <GemIcon className="h-8 w-8 text-indigo-500" />
                            }
                            userName={displayUser?.fullName || "User"}
                            bannerTitle="Projects Portfolio"
                            description="Showcase of your projects by sharing them individually or your entire portfolio to anyone."
                            userTier={userTier}
                            isUserBanner={true}
                            gradientFrom="indigo-900"
                            gradientVia="blue-800"
                            gradientTo="purple-800"
                            borderColor="border-indigo-700/40"
                            tierBgColor="bg-indigo-700/60"
                            textGradient="from-fuchsia-400 via-indigo-400 to-cyan-400"
                          />
                          <ProjectList
                            currentPage={currentPage}
                            showSortingFilters={true}
                            onPageChange={setCurrentPage}
                            showUserProjectsOnly={true}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </ProtectedPage>
              <FooterSection />
            </SidebarInset>
          </SidebarProvider>
        </ProjectsProvider>
      )}
    </>
  );
}
