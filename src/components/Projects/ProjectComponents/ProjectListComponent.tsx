"use client";
// UI07: the list controls, states and pagination on the foundations. The
// list logic (filters, sort, favorites, delete, paging) is unchanged.
import "@/styles/foundations.css";
import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useProjects } from "@/providers/projects-provider";
import { Button } from "@/components/ui/button";
import { GridIcon, TableIcon, Plus } from "lucide-react";
import { ProjectCardView } from "./ProjectCardViewComponent";
import { ProjectTableView } from "./ProjectTableViewComponent";
import { ProjectForm } from "../ProjectComponents/ProjectFormComponent";
import { ProjectCategory } from "@/constants/project-categories";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";

import {
  removeProject,
  addProjectFavorite,
  removeProjectFavorite,
} from "@/app/actions/projects";
import { toast } from "sonner";
import { Project } from "@/types/models/project";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import { UnfavoriteConfirmationModal } from "./UnfavoriteConfirmationModal";
import { PaginationControls } from "@/components/navigation/Pagination/PaginationControlComponent";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectFilters } from "@/providers/projects-provider";
import { SortBySelect, CategorySelect, SortByValue } from "@/components/filters";
import { useCategoryCounts } from "@/hooks/use-category-counts";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { SignInButtonComponent } from "@/components/auth/SignInButtonComponent";
import ShareProjectsButton from "../ShareProjectsButton";
import { useViewerId } from "@/components/auth/AuthGate";
import { useRouter } from "next/navigation";

interface ProjectListProps {
  currentPage: number;
  filter?: {
    userId?: string;
    all?: boolean;
  };
  showSortingFilters?: boolean;
  hideCategoryFilter?: boolean;
  onPageChange: (page: number) => void;
  onFilteredItemsChange?: (count: number) => void;
  showUserProjectsOnly?: boolean;
  showFavoritesOnly?: boolean;
  showDeletedOnly?: boolean;
  allowAnonymousView?: boolean;
}

export const ProjectList = React.memo(function ProjectList({
  currentPage: externalPage = CURRENT_PAGE,
  filter,
  showSortingFilters = true,
  hideCategoryFilter = false,
  onPageChange,
  onFilteredItemsChange,
  showUserProjectsOnly = false,
  showFavoritesOnly = false,
  showDeletedOnly = false,
  allowAnonymousView = false,
}: ProjectListProps) {
  const {
    projects,
    loading,
    handleProjectDeleted,
    handleProjectUpdated,
    handleProjectAdded: contextHandleProjectAdded,
    isAuthenticated,
    filters,
    setFilters,
    setProjects,
    pagination,
    error,
    retry,
    retrying,
  } = useProjects();

  // D02r-c: the category-count filters follow the session (Clerk's userId by
  // default, the Better Auth session's under the switch). D03: so does the
  // delete control, whose action now takes the user from the session. D05:
  // and the favorite controls; their actions take the user from the session
  // too and are no longer sent an ID.
  // D08g4e2: and the create/share buttons.
  const viewerId = useViewerId();
  const userId = viewerId;
  const router = useRouter();

  // Determine category counts filter based on current view
  const categoryCountsFilters = React.useMemo(() => {
    if (showDeletedOnly && viewerId) {
      return { userId: viewerId, deleted: true };
    }
    if (showFavoritesOnly && viewerId) {
      return { userId: viewerId, favorites: true };
    }
    if (showUserProjectsOnly && viewerId) {
      return { userId: viewerId };
    }
    // Community view - global counts
    return undefined;
  }, [showUserProjectsOnly, showFavoritesOnly, showDeletedOnly, viewerId]);

  const { hasCategoryProjects } = useCategoryCounts(categoryCountsFilters);
  const [viewMode, setViewMode] = useState("card");
  const [isMobile, setIsMobile] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null
  );
  const [showUnfavoriteModal, setShowUnfavoriteModal] = useState(false);
  const [unfavoritingProject, setUnfavoritingProject] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isUnfavoriting, setIsUnfavoriting] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  // Wait for layout to be ready before showing skeleton
  useEffect(() => {
    setLayoutReady(true);
  }, []);

  // Check for mobile screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  // Sync external page changes with provider
  useEffect(() => {
    if (externalPage !== filters.page) {
      setFilters({ page: externalPage });
    }
  }, [externalPage, filters.page, setFilters]);

  // Notify parent of filtered items count changes
  useEffect(() => {
    if (onFilteredItemsChange) {
      onFilteredItemsChange(pagination.total);
    }
  }, [pagination.total, onFilteredItemsChange]);

  // Set initial view state
  useEffect(() => {
    setFilters({
      showMyProjects: showUserProjectsOnly,
      showFavorites: showFavoritesOnly,
      showDeleted: showDeletedOnly,
      page: externalPage,
    });
  }, [
    showUserProjectsOnly,
    showFavoritesOnly,
    showDeletedOnly,
    externalPage,
    setFilters,
  ]);

  // Handle page changes
  const handlePageChange = useCallback(
    (page: number) => {
      // Store the current scroll position and container height
      const scrollPosition = window.scrollY;
      const container = document.querySelector(".projects-container");
      const containerHeight = container?.getBoundingClientRect().height;

      // Apply the container height to prevent content shift
      if (container && containerHeight) {
        (container as HTMLElement).style.minHeight = `${containerHeight}px`;
      }

      if (page > pagination.totalPages) {
        page = pagination.totalPages;
      }

      if (page === pagination.currentPage) {
        return;
      }

      const newFilters: Partial<ProjectFilters> = { page };
      setFilters(newFilters);

      if (onPageChange) {
        onPageChange(page);
      }

      // Restore scroll position after content update
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollPosition,
          behavior: "instant",
        });

        // Reset the container height after the content has updated
        if (container) {
          setTimeout(() => {
            (container as HTMLElement).style.minHeight = "";
          }, 100);
        }
      });
    },
    [setFilters, onPageChange, pagination.totalPages, pagination.currentPage]
  );

  // Handlers
  const handleViewDetails = useCallback((id: string) => {
    // TODO: View details handler - currently unused but kept for future implementation
  }, []);

  const handleToggleFavorite = useCallback(
    async (id: string, isFavorite: boolean) => {
      if (!viewerId) return;

      try {
        if (!isFavorite) {
          const project = projects.find((p) => p.id === id);
          if (project) {
            setUnfavoritingProject({ id, title: project.title });
            setShowUnfavoriteModal(true);
            return;
          }
        }

        await handleFavoriteAction(id, isFavorite);
      } catch (error) {
        console.error("Error toggling favorite:", error);
        toast.error("Failed to update favorite status");
      }
    },
    [viewerId, setProjects, projects]
  );

  const handleFavoriteAction = async (id: string, isFavorite: boolean) => {
    try {
      // D07x: the actions answer { success: false } rather than throwing; a
      // refused change used to show "Added to favorites" and move the count.
      const result = isFavorite ? await addProjectFavorite(id) : await removeProjectFavorite(id);
      if (!result.success) {
        toast.error(result.error || "Failed to update favorite status");
        return;
      }

      // If we're unfavoriting and on the favorites page, remove from UI immediately
      if (!isFavorite && showFavoritesOnly) {
        // Remove from current state immediately
        setProjects((prev) => (prev ?? projects).filter((p) => p.id !== id));

        // Force a refresh of the projects list
        if (handleProjectDeleted) {
          await handleProjectDeleted(id);
        }

        toast.success("Removed from favorites");
        return;
      }

      // For all other cases, update the project in the current state
      const updatedProject = projects.find((p) => p.id === id);
      if (updatedProject) {
        const currentFavorites = Number(updatedProject.total_favorites || 0);
        const newFavorites = isFavorite
          ? currentFavorites + 1
          : Math.max(0, currentFavorites - 1);
        const projectWithUpdatedFavorite = {
          ...updatedProject,
          isFavorite,
          total_favorites: newFavorites.toString(),
        };

        // Update local state immediately for optimistic UI
        // This preserves the current sort order (favorite actions shouldn't change "recently edited" order)
        setProjects((prev) =>
          (prev ?? projects).map((project) =>
            project.id === id ? projectWithUpdatedFavorite : project
          )
        );
        // No cache invalidation needed - other pages will fetch fresh data on mount
      }

      toast.success(
        isFavorite ? "Added to favorites" : "Removed from favorites"
      );
    } catch (error) {
      console.error("Error updating favorite status:", error);
      toast.error("Failed to update favorite status");
    } finally {
      setIsUnfavoriting(false);
      setUnfavoritingProject(null);
      setShowUnfavoriteModal(false);
    }
  };

  const handleUnfavoriteConfirm = async () => {
    if (!unfavoritingProject) return;
    setIsUnfavoriting(true);
    await handleFavoriteAction(unfavoritingProject.id, false);
  };

  const handleProjectDeletion = useCallback(
    (projectId: string, isPermanent: boolean = false) => {
      if (!isPermanent) {
        const project = projects?.find((p) => p.id === projectId);
        if (project) {
          setProjectToDelete(project);
          setShowDeleteDialog(true);
        }
      } else {
        if (handleProjectDeleted) {
          handleProjectDeleted(projectId);
        }
      }
    },
    [projects, handleProjectDeleted]
  );

  const handleUpdateProject = useCallback(
    (project: Project) => {
      router.push(`/projects/${project.slug}?edit=true`);
    },
    [router]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!projectToDelete || !viewerId) return;

    try {
      setDeletingProjectId(projectToDelete.id);
      setShowDeleteDialog(false);

      // D03: the server takes the user from the session; the ID is ignored.
      const result = await removeProject(projectToDelete.id, viewerId);

      if (!result.success) {
        toast.error(result.error || "Failed to delete project");
        return;
      }

      // Remove from current state immediately
      setProjects((prev) => (prev ?? projects).filter((p) => p.id !== projectToDelete.id));

      // Call the context handler to ensure global state is updated
      if (handleProjectDeleted) {
        await handleProjectDeleted(projectToDelete.id);
      }

      toast.success("Project sent to graveyard");
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast.error("An error occurred while deleting the project");
    } finally {
      setDeletingProjectId(null);
      setProjectToDelete(null);
    }
  }, [projectToDelete, handleProjectDeleted, viewerId, setProjects]);

  // Category change handler with proper typing
  const handleCategoryChange = useCallback(
    (category: ProjectCategory | "all") => {
      // Store the current scroll position and container height
      const scrollPosition = window.scrollY;
      const container = document.querySelector(".projects-container");
      const containerHeight = container?.getBoundingClientRect().height;

      // Apply the container height to prevent content shift
      if (container && containerHeight) {
        (container as HTMLElement).style.minHeight = `${containerHeight}px`;
      }

      // Create a completely new filter state object preserving existing filters
      const newFilters = {
        ...filters,
        category,
        page: 1,
        showMyProjects: showUserProjectsOnly,
        showFavorites: showFavoritesOnly,
        showDeleted: showDeletedOnly,
      };

      // Set the complete new state
      setFilters(newFilters);

      // Ensure parent components are notified of page change
      if (onPageChange) {
        onPageChange(1);
      }

      // Restore scroll position after content update
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollPosition,
          behavior: "instant",
        });

        // Reset the container height after the content has updated
        if (container) {
          setTimeout(() => {
            (container as HTMLElement).style.minHeight = "";
          }, 100);
        }
      });
    },
    [
      filters,
      setFilters,
      showUserProjectsOnly,
      showFavoritesOnly,
      showDeletedOnly,
      onPageChange,
    ]
  );

  // Sort change handler with proper typing
  const handleSortChange = useCallback(
    (sortBy: SortByValue) => {
      const newFilters: Partial<ProjectFilters> = { sortBy, page: 1 };
      setFilters(newFilters);

      if (onPageChange) {
        onPageChange(1);
      }
    },
    [setFilters, onPageChange]
  );

  // Show projects even when not authenticated if allowAnonymousView is true
  if (!isAuthenticated && !allowAnonymousView) {
    return (
      <div className="cd-foundations cd-empty">
        <Image src="/images/mascot.png" alt="" width={128} height={166} sizes="128px" />
        <p className="cd-lead">Please sign in to view projects 🔐</p>
        <SignInButtonComponent text="Sign In" useTypingEffect={false} variant="plain" />
      </div>
    );
  }

  // Loading state
  if (loading) {
    // Don't show skeleton until layout is ready to avoid width calculation issues
    if (!layoutReady) {
      return null;
    }
    return <ProjectListLoadingState />;
  }

  // UI07.3: one message per situation. A failed request says so and offers
  // Try again; it used to look exactly like an empty list.
  const emptyTitle = showDeletedOnly
    ? "The Project Graveyard is Empty! 🪦"
    : showFavoritesOnly
    ? "Your Collection Awaits! ⭐"
    : showUserProjectsOnly
    ? "Time to Showcase Your Genius! 🚀"
    : "It's your time to shine! 💫";
  const emptyText = showDeletedOnly
    ? "Looks like all projects are alive and kicking!"
    : showFavoritesOnly
    ? "Start exploring and mark your favorite projects"
    : showUserProjectsOnly
    ? "Share your coding adventures with the community"
    : "Be the creator and let the world see your brilliance!";

  return (
    <div className="cd-foundations cd-stack">
      {/* Controls Section */}
      <div className="cd-filter-bar">
        {/* Left side buttons */}
        <div className="cd-cluster">
          {/* Create Project Button - only show for authenticated users */}
          {!showDeletedOnly && userId && (
            <Button variant="default" onClick={() => router.push("/projects/new")} className="cursor-pointer">
              <Plus size={16} aria-hidden="true" />
              Create Project
            </Button>
          )}
          {/* Share Projects Button - only show for authenticated users */}
          {userId && showUserProjectsOnly && <ShareProjectsButton userId={userId} />}
        </div>

        {/* Right side controls */}
        {showSortingFilters && (
          <div className="cd-cluster items-end">
            <SortBySelect
              value={filters.sortBy as SortByValue}
              onValueChange={handleSortChange}
              triggerClassName="w-full sm:w-[200px]"
            />

            {/* Category Filter - only show if not hidden */}
            {!hideCategoryFilter && (
              <CategorySelect
                value={filters.category}
                onValueChange={handleCategoryChange}
                triggerClassName="w-full sm:w-[240px]"
                hasCategoryProjects={hasCategoryProjects}
              />
            )}

            {/* View Mode Toggle (wider screens; phones always get cards) */}
            <div className="hidden md:flex cd-field">
              <span className="cd-field-label" id="project-view-label">View</span>
              <div className="cd-segmented" role="group" aria-labelledby="project-view-label">
                <Button
                  variant="ghost"
                  className="cursor-pointer"
                  aria-pressed={viewMode === "card"}
                  onClick={() => setViewMode("card")}
                >
                  <GridIcon className="h-4 w-4" aria-hidden="true" />
                  Cards
                </Button>
                <Button
                  variant="ghost"
                  className="cursor-pointer"
                  aria-pressed={viewMode === "table"}
                  onClick={() => setViewMode("table")}
                >
                  <TableIcon className="h-4 w-4" aria-hidden="true" />
                  Table
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* How many, announced when a filter or page changes */}
      <p className="cd-small cd-muted cd-number" role="status">
        {error
          ? ""
          : pagination.total > 0
          ? `${pagination.total} ${pagination.total === 1 ? "project" : "projects"}${pagination.totalPages > 1 ? `, page ${pagination.currentPage} of ${pagination.totalPages}` : ""}`
          : ""}
      </p>

      {/* Projects Display */}
      {error ? (
        <div role="alert" className="cd-surface cd-empty" style={{ borderColor: "var(--cd-danger)" }}>
          <p className="cd-subheading">Projects didn&apos;t load</p>
          <p className="cd-small cd-muted cd-reading">Something went wrong on our side. Your projects are safe; try again in a moment.</p>
          <Button variant="outline" onClick={() => retry?.()} disabled={retrying}>
            {retrying ? (
              <>
                <span aria-hidden="true" className="cd-spinner animate-spin" />
                Trying again…
              </>
            ) : (
              "Try again"
            )}
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <div className="cd-surface cd-empty">
          <Image src="/images/mascot.png" alt="" width={160} height={207} sizes="160px" />
          <p className="cd-heading">{emptyTitle}</p>
          <p className="cd-lead cd-muted cd-reading">{emptyText}</p>
          {filter?.userId === userId && !showDeletedOnly && (
            <Button variant="default" onClick={() => setShowAddForm(true)}>
              Create Your First Project or Keep Exploring
            </Button>
          )}
        </div>
      ) : (
        <>
          {viewMode === "card" || isMobile ? (
            <ProjectCardView
              projects={projects}
              onViewDetails={handleViewDetails}
              onToggleFavorite={handleToggleFavorite}
              onDeleteProject={handleProjectDeletion}
              onUpdateProject={handleUpdateProject}
            />
          ) : (
            <div className="hidden md:block">
              <ProjectTableView
                projects={projects}
                onToggleFavorite={handleToggleFavorite}
                onUpdateProject={handleUpdateProject}
                onDeleteProject={handleProjectDeletion}
              />
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </>
      )}

      {/* Modals */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent className="max-w-[900px] max-h-[100vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Add a new project to share with the community.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            onProjectAdded={(newProject) => {
              // Close the modal
              setShowAddForm(false);
              // Call the context handler to update the project list
              contextHandleProjectAdded(newProject);
            }}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmationModal
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDeleteConfirm}
        project={projectToDelete}
        isDeleting={Boolean(deletingProjectId)}
      />

      <UnfavoriteConfirmationModal
        project={unfavoritingProject}
        isOpen={showUnfavoriteModal}
        onClose={() => {
          setShowUnfavoriteModal(false);
          setUnfavoritingProject(null);
        }}
        onConfirm={handleUnfavoriteConfirm}
        isUnfavoriting={isUnfavoriting}
      />
    </div>
  );
});
