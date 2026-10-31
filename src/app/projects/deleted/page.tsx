"use client";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
import { Skull } from "lucide-react";
import { CodeParticlesElement } from "@/components/Elements/CodeParticlesElement";

export default function DeletedProjects() {
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);

  // D02r-c: Clerk's values by default; the Better Auth session under the switch.
  const viewer = usePersonalPageViewer();
  // D04f: keyed on the session's viewer (Clerk's ID, or the Better Auth
  // session's under the switch); the route reads the tier from the session.
  const { userTier } = useUserTier(viewer.userId);
  const { user: displayUser } = useDisplayUser();

  // Determine overall loading state
  const isLoading = viewer.isLoading;

  // Graveyard-themed emojis for the particles
  const graveyardEmojis = [
    { symbol: "🪦", type: "emoji" },
    { symbol: "💀", type: "emoji" },
    { symbol: "☠️", type: "emoji" },
    { symbol: "👻", type: "emoji" },
    { symbol: "🧟", type: "emoji" },
    { symbol: "🦇", type: "emoji" },
    { symbol: "🕷️", type: "emoji" },
    { symbol: "⚰️", type: "emoji" },
  ];

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
          userId={viewer.userId}
          isLoading={isLoading}
        >
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <HeaderSection />
              <ProtectedPage allowedTiers={PROTECTED_PAGES_TIERS}>
                <div className="flex justify-center w-full mb-20 relative">
                  {/* Graveyard particles background */}
                  <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
                    <CodeParticlesElement
                      quantity="medium"
                      speed="variable"
                      size="large"
                      containerClassName="w-full h-full"
                      includeEmojis={false}
                      includeKeywords={false}
                      includeSymbols={false}
                      customSymbols={graveyardEmojis}
                      depth="layered"
                      opacityRange={[0.4, 0.7]}
                      lightModeOpacityRange={[0.4, 0.7]}
                    />
                  </div>
                  <div className="w-full px-4 2xl:px-8 3xl:px-12 relative z-10">
                    <div className="flex flex-col gap-4 mb-6 py-3">
                      <div className="mb-8">
                        <div className="flex flex-col space-y-4">
                          <PageBanner
                            icon={<Skull className="h-8 w-8 text-red-500" />}
                            userName={displayUser?.fullName || "User"}
                            bannerTitle="Digital Graveyard"
                            description="A resting place for your deleted projects. They are no longer active in the community, but you can review and restore them if needed or kill them off permanently from here 🔪"
                            userTier={userTier}
                            isUserBanner={true}
                            gradientFrom="red-900"
                            gradientVia="gray-800"
                            gradientTo="black"
                            borderColor="border-red-700/40"
                            tierBgColor="bg-red-900/60"
                            textGradient="from-red-500 via-gray-400 to-red-700"
                          />
                          <ProjectList
                            currentPage={currentPage}
                            showSortingFilters={true}
                            onPageChange={setCurrentPage}
                            showDeletedOnly={true}
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
