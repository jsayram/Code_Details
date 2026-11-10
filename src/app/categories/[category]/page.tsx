"use client";

// UI07: one category's projects on AppShell and the foundations. The header
// carries the category's color and its full description, tie-break wording
// included. The list, sort and pagination are unchanged; the category filter
// stays hidden here, as before.
import "@/styles/foundations.css";
import { useState, use } from "react";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { ProjectList } from "@/components/Projects";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";

interface PageProps {
  params: Promise<{ category: string }>;
}

export default function CategoryPage({ params }: PageProps) {
  const resolvedParams = params instanceof Promise ? use(params) : params;
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);

  // Decode and validate the category
  const category = decodeURIComponent(resolvedParams.category);
  const categoryInfo = PROJECT_CATEGORIES[category as keyof typeof PROJECT_CATEGORIES];
  const validatedCategory = Object.keys(PROJECT_CATEGORIES).includes(category)
    ? (category as keyof typeof PROJECT_CATEGORIES)
    : "all";

  // Determine loading state
  const isLoading = viewer.isLoading;

  return (
    <ProjectsProvider
      userId={viewer.userId}
      isLoading={isLoading}
      allowAnonymousView
      initialFilters={{ category: validatedCategory }}
    >
      <AppShell>
        <div className="cd-foundations cd-canvas">
          <div className="cd-page cd-stack">
            <DiscoveryHeader
              eyebrow="Category"
              icon={<span className="cd-cat cd-cat-dot" data-category={validatedCategory} style={{ width: "1.25rem", height: "1.25rem", marginBlockStart: 0 }} />}
              title={`${categoryInfo?.label || category} Projects`}
              lead={categoryInfo?.description || "Browse projects in this category"}
            />
            <ProjectList
              currentPage={currentPage}
              showSortingFilters={true}
              hideCategoryFilter={true}
              onPageChange={setCurrentPage}
              allowAnonymousView
            />
          </div>
        </div>
      </AppShell>
    </ProjectsProvider>
  );
}
