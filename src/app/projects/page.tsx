"use client";
// UI07: on AppShell and the foundations, with a plain header instead of the
// gradient banner. The list, its filters and its personal actions are unchanged.
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";

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
        <AppShell>
          {/* F02: public. Signed-out visitors get the same list, minus personal actions. */}
          <div className="cd-foundations cd-canvas">
            <div className="cd-page cd-stack">
              <DiscoveryHeader
                eyebrow="Community"
                title="Community Projects"
                lead="Explore a diverse range of community projects. Discover, contribute, and be inspired by the creativity and innovation of fellow developers."
              />
              <ProjectList
                currentPage={allProjectsPage}
                showSortingFilters={true}
                onPageChange={handleAllProjectsPageChange}
                allowAnonymousView
              />

              <SignedIn>
                <Dialog open={isProjectFormOpen} onOpenChange={setIsProjectFormOpen}>
                  <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                      <DialogTitle>Create New Project</DialogTitle>
                      <DialogDescription>Add a new project to share with the community.</DialogDescription>
                    </DialogHeader>
                    <ProjectForm onProjectAdded={handleProjectAdded} />
                  </DialogContent>
                </Dialog>
              </SignedIn>
            </div>
          </div>
        </AppShell>
      </ProjectsProvider>
    </>
  );
}
