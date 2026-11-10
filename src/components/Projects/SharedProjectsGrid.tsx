"use client";

// UI06.3: the public profile's project list. Loading, failure and empty now
// look different (UI02 defect 4): a failed request says so and offers Try
// again instead of claiming the person has shared nothing.
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectCardView } from "./ProjectComponents/ProjectCardViewComponent";
import { ProjectCardSkeleton } from "@/components/LoadingState/ProjectListLoadingState";
import { Project } from "@/types/models/project";
import { PaginationControls } from "@/components/navigation/Pagination/PaginationControlComponent";
import { PROJECTS_PER_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import { API_ROUTES } from "@/constants/api-routes";
import { SortBySelect, CategorySelect, SortByValue } from "@/components/filters";
import { ProjectCategory } from "@/constants/project-categories";
import { useUserCategoryCounts } from "@/hooks/use-user-category-counts";
import { Button } from "@/components/ui/button";

interface SharedProjectsGridProps {
  username: string;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  /** Reports the total once a page has loaded, so the page title can show it. */
  onTotalChange?: (total: number | null) => void;
}

export function SharedProjectsGrid({
  username,
  currentPage = 1,
  onPageChange,
  onTotalChange,
}: SharedProjectsGridProps) {
  const router = useRouter();
  const { hasCategoryProjects } = useUserCategoryCounts(username);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<
    ProjectCategory | "all"
  >("all");
  const [sortBy, setSortBy] = useState<SortByValue>("random");
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 1,
    currentPage: 1,
  });

  const fetchSharedProjects = useCallback(async () => {
    try {
      setLoading(true);
      setFailed(false);
      const url = API_ROUTES.PROJECTS.SHARED(username, {
        page: currentPage,
        limit: PROJECTS_PER_PAGE,
        showAll: true,
        sortBy,
        category: selectedCategory === "all" ? undefined : selectedCategory,
      });

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ API Error Response:", {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        throw new Error(
          `HTTP error! status: ${response.status}, body: ${errorText}`
        );
      }

      const result = await response.json();

      // Check if this is a redirect response (old username was used)
      if (result.redirect && result.currentUsername) {
        router.replace(`/shared-projects/${encodeURIComponent(result.currentUsername)}`);
        return;
      }

      // Handle RFC 7807 success response format: { success: true, data: { data: [...], pagination: {...} } }
      const responseData = result.success ? result.data : result;

      // The redirect can also arrive inside the success wrapper.
      if (responseData?.redirect && responseData.currentUsername) {
        router.replace(`/shared-projects/${encodeURIComponent(responseData.currentUsername)}`);
        return;
      }

      if (!responseData.data || !Array.isArray(responseData.data)) {
        throw new Error("Invalid response format");
      }

      interface SharedProjectData {
        project: {
          id: string;
          title: string;
          slug: string;
          description: string | null;
          category: string | null;
          created_at: string | null;
          updated_at: string | null;
          user_id: string;
          deleted_at: string | null;
          total_favorites: number;
          isFavorite?: boolean;
        };
        profile: {
          username: string | null;
          profile_image_url: string | null;
          full_name: string | null;
        };
        tags: string[] | null;
      }

      setProjects(
        responseData.data.map((projectData: SharedProjectData) => {
          const category = projectData.project.category || "other";
          return {
            ...projectData.project,
            tags: projectData.tags || [],
            category: category as ProjectCategory,
            isFavorite: projectData.project.isFavorite || false,
            profile: projectData.profile,
          };
        })
      );
      setPagination({
        total: responseData.pagination?.total ?? 0,
        totalPages: responseData.pagination?.totalPages ?? 1,
        currentPage: responseData.pagination?.page ?? currentPage,
      });
      onTotalChange?.(responseData.pagination?.total ?? 0);
    } catch (error) {
      console.error("❌ Error in fetchSharedProjects:", error);
      setProjects([]);
      setFailed(true);
      onTotalChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [username, currentPage, sortBy, selectedCategory, router, onTotalChange]);

  useEffect(() => {
    fetchSharedProjects();
  }, [fetchSharedProjects]);

  const handlePageChange = (page: number) => {
    onPageChange?.(page);
  };

  const handleCategoryChange = (category: ProjectCategory | "all") => {
    setSelectedCategory(category);
  };

  const handleSortChange = (value: SortByValue) => {
    setSortBy(value);
  };

  return (
    <div className="cd-stack">
      {/* Controls: labelled selects (UI07.2) */}
      <div className="cd-filter-bar justify-start">
        <CategorySelect
          value={selectedCategory}
          onValueChange={handleCategoryChange}
          triggerClassName="w-full sm:w-[240px]"
          hasCategoryProjects={hasCategoryProjects}
        />
        <SortBySelect
          value={sortBy}
          onValueChange={handleSortChange}
          triggerClassName="w-full sm:w-[200px]"
        />
      </div>

      <p role="status" className="sr-only">
        {loading ? "Loading projects" : ""}
      </p>

      {loading ? (
        <div className="cd-card-grid" aria-hidden="true">
          {Array.from({ length: Math.min(PROJECTS_PER_PAGE, 8) }).map((_, i) => (
            <ProjectCardSkeleton key={i} delay={i * 20} />
          ))}
        </div>
      ) : failed ? (
        <div
          role="alert"
          className="cd-surface flex flex-wrap items-center justify-between gap-4"
          style={{ borderColor: "var(--cd-danger)" }}
        >
          <div className="cd-stack-tight cd-reading">
            <p className="cd-subheading">Projects didn&apos;t load</p>
            <p className="cd-small cd-muted">
              Something went wrong on our side, so we can&apos;t show {username}&apos;s projects right now.
            </p>
          </div>
          <Button variant="outline" onClick={() => fetchSharedProjects()}>
            Try again
          </Button>
        </div>
      ) : projects.length > 0 ? (
        <>
          <ProjectCardView
            projects={projects}
            onViewDetails={() => {}}
            onToggleFavorite={() => {}}
            onDeleteProject={() => {}}
            onUpdateProject={() => {}}
          />
          {pagination.totalPages > 1 && (
            <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </>
      ) : (
        <div className="cd-surface cd-stack-tight items-center py-12 text-center">
          <p className="cd-subheading">No Projects Found</p>
          <p className="cd-muted cd-wrap">
            {selectedCategory === "all"
              ? `${username} hasn't shared any projects yet.`
              : `${username} hasn't shared any projects in this category.`}
          </p>
        </div>
      )}
    </div>
  );
}
