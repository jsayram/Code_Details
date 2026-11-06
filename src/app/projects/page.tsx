"use client";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// React Core
import React, { use, useMemo, useState } from "react";

// Authentication (Clerk)
import { SignedIn } from "@/components/auth/AuthGate";

// Custom Hooks
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";

// Application Components and Pages (Custom)
import { ProjectsProvider } from "@/providers/projects-provider";
import {
  ProjectList,
  ProjectForm,
} from "@/components/Projects";

// UI Components (Tailwind CSS) and shadcn/ui components
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CURRENT_PAGE,
} from "@/components/navigation/Pagination/paginationConstants";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import Image from "next/image";
import { Code2 } from "lucide-react";
import { PageBanner } from "@/components/ui/page-banner";

export default function DashBoard() {
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();

  // At the top of your component
  const [allProjectsPage, setAllProjectsPage] = useState(CURRENT_PAGE);

  const [isProjectFormOpen, setIsProjectFormOpen] = useState(false);

  // Determine overall loading state
  const isLoading = viewer.isLoading;

  // Handlers for pagination
  const handleAllProjectsPageChange = (page: number) => {
    setAllProjectsPage(page);
  };

  const handleProjectAdded = () => {
    setIsProjectFormOpen(false);
  };

  return (
    <>
      <ProjectsProvider
        userId={viewer.userId}
        isLoading={isLoading}
        allowAnonymousView
      >
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <HeaderSection />

            {/* F02: public. Signed-out visitors get the same list, minus personal actions. */}
            <div className="flex justify-center w-full mb-20">
              <div className="w-full px-4 2xl:px-8 3xl:px-12">
                {/* Main content */}
                <div className="flex flex-col gap-4">
                  {/* All Projects Section */}
                  <div className="mb-8">
                    <div className="flex flex-col space-y-4">
                      <PageBanner
                        bannerTitle="Community Projects"
                        description="Explore a diverse range of community projects. Discover, contribute, and be inspired by the creativity and innovation of fellow developers."
                        isUserBanner={false}
                        gradientFrom="indigo-900"
                        gradientVia="blue-800"
                        gradientTo="purple-800"
                        borderColor="border-indigo-700/40"
                        textGradient="from-fuchsia-400 via-indigo-400 to-cyan-400"
                        logo={{
                          src: "/images/CodeDetails_IconLogo.png",
                          alt: "Code Details Logo",
                          width: 50,
                          height: 50
                        }}
                      />
                      <ProjectList
                        currentPage={allProjectsPage}
                        showSortingFilters={true}
                        onPageChange={handleAllProjectsPageChange}
                        allowAnonymousView
                      />
                    </div>
                  </div>

                  <SignedIn>
                    <Dialog
                      open={isProjectFormOpen}
                      onOpenChange={setIsProjectFormOpen}
                    >
                      <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                          <DialogTitle>Create New Project</DialogTitle>
                          <DialogDescription>
                            Add a new project to share with the community.
                          </DialogDescription>
                        </DialogHeader>
                        <ProjectForm
                          onProjectAdded={handleProjectAdded}
                        />
                      </DialogContent>
                    </Dialog>
                  </SignedIn>
                </div>
              </div>
            </div>
            <FooterSection />
          </SidebarInset>
        </SidebarProvider>
      </ProjectsProvider>
    </>
  );
}
