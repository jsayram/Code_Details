"use client";

// UI07: one tag's projects on AppShell and the foundations. Same list, sort,
// category filter and pagination as before; public, like /categories/<key>.
import "@/styles/foundations.css";
import { useState, useEffect, use } from "react";
import { Hash } from "lucide-react";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { ProjectList } from "@/components/Projects";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";

interface PageProps {
  params: Promise<{ tag: string }>;
}

export default function TagPage({ params }: PageProps) {
  const resolvedParams = params instanceof Promise ? use(params) : params;
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);
  const [decodedTag, setDecodedTag] = useState<string>("");

  useEffect(() => {
    if (resolvedParams.tag) {
      // Normalize tag name: decode URL and convert to lowercase for case-insensitive matching
      const normalizedTag = decodeURIComponent(resolvedParams.tag).toLowerCase().trim();
      setDecodedTag(normalizedTag);
    }
  }, [resolvedParams.tag]);

  // Determine overall loading state
  const isLoading = viewer.isLoading || !decodedTag;

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          {isLoading ? (
            <ProjectListLoadingState />
          ) : (
            <ProjectsProvider
              userId={viewer.userId}
              isLoading={isLoading}
              allowAnonymousView
              initialFilters={{ tags: [decodedTag] }}
            >
              <div className="cd-stack">
                <DiscoveryHeader
                  eyebrow="Tag"
                  icon={<Hash className="h-7 w-7" />}
                  title={<>Projects Tagged with &ldquo;{decodedTag}&rdquo;</>}
                  lead="Browse projects with this tag"
                />
                <ProjectList
                  currentPage={currentPage}
                  showSortingFilters={true}
                  onPageChange={setCurrentPage}
                  allowAnonymousView
                />
              </div>
            </ProjectsProvider>
          )}
        </div>
      </div>
    </AppShell>
  );
}
