"use client";

// UI07: the graveyard on AppShell and the foundations. Still owner-only:
// ProtectedPage sends signed-out visitors to sign in, and the provider never
// fetches a personal list without a session. The list itself is unchanged.
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader, TierStatus } from "@/components/layout/DiscoveryHeader";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { useDisplayUser } from "@/components/auth/useDisplayUser";
import { ProjectsProvider } from "@/providers/projects-provider";
import { ProjectList } from "@/components/Projects";
import ProtectedPage from "@/app/auth/ProtectedPage";
import { PROTECTED_PAGES_TIERS } from "@/app/auth/protectedPageConstants";
import { useUserTier } from "@/hooks/use-user-tier";
import { useState } from "react";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";

export default function DeletedProjects() {
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);

  // D02r-c: Clerk's values by default; the Better Auth session under the switch.
  const viewer = usePersonalPageViewer();
  // D04f: keyed on the session's viewer; the route reads the tier from the session.
  const { userTier } = useUserTier(viewer.userId);
  const { user: displayUser } = useDisplayUser();
  const firstName = (displayUser?.fullName || "User").split(" ")[0];

  // Determine overall loading state
  const isLoading = viewer.isLoading;

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          {isLoading ? (
            <ProjectListLoadingState />
          ) : (
            <ProjectsProvider userId={viewer.userId} isLoading={isLoading}>
              <ProtectedPage allowedTiers={PROTECTED_PAGES_TIERS}>
                <div className="cd-stack">
                  <DiscoveryHeader
                    eyebrow={`${firstName}'s deleted projects`}
                    title="Digital Graveyard"
                    lead="A resting place for your deleted projects. They are no longer active in the community, but you can review and restore them if needed or kill them off permanently from here 🔪"
                    aside={<TierStatus tier={userTier} />}
                  />
                  <ProjectList
                    currentPage={currentPage}
                    showSortingFilters={true}
                    onPageChange={setCurrentPage}
                    showDeletedOnly={true}
                  />
                </div>
              </ProtectedPage>
            </ProjectsProvider>
          )}
        </div>
      </div>
    </AppShell>
  );
}
