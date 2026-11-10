"use client";
// UI07: the table is a dense view, so it uses compact controls (36px with a
// mouse, 44px on touch). Keyboard and screen readers can now use it: the
// title, category and tags are links, the column headers are sort buttons
// with aria-sort, and the edit and delete buttons have names. A click on a
// row still opens the project, and the sort, column settings and the
// category and tag delays work as before.

import React, { useState, useMemo } from "react";
import { Project } from "@/types/models/project";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Heart, Trash2, Settings2, ChevronUp } from "lucide-react";
import { FormattedDate } from "@/lib/FormattedDate";
import { PROJECT_CATEGORIES, ProjectCategory } from "@/constants/project-categories";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/utils/stringUtils";
import { useViewerId } from "@/components/auth/AuthGate";
import { FavoriteButton } from "./FavoriteButton";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";

interface ProjectTableViewProps {
  projects: Project[];
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
  onDeleteProject?: (id: string, isPermanent?: boolean) => void;
  onUpdateProject?: (project: Project) => void;
}

interface SortConfig {
  key: keyof Project;
  direction: "asc" | "desc";
}

const COLUMNS = [
  { key: "title", label: "Title", required: true },
  { key: "description", label: "Description", required: false },
  { key: "category", label: "Category", required: false },
  { key: "tags", label: "Tags", required: false },
  { key: "creator", label: "Creator", required: false },
  { key: "created_at", label: "Created", required: false },
];

const ROW_HEIGHT = "h-30";
const DIM_OPACITY = 0.2;

export function ProjectTableView({
  projects,
  onToggleFavorite,
  onDeleteProject,
  onUpdateProject,
}: ProjectTableViewProps) {
  // D08g4e2: the session's user (Clerk's or Better Auth's).
  const userId = useViewerId();
  const router = useRouter();
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: "created_at", direction: "desc" });
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("projectTableHiddenColumns");
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [navigatingProjectId, setNavigatingProjectId] = useState<string | null>(null);
  const [loadingTag, setLoadingTag] = useState<string | null>(null);
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);

  const getDisplayName = (project: Project): string => {
    if (project.profile?.full_name) return project.profile.full_name;
    if (project.profile?.first_name || project.profile?.last_name) {
      return [project.profile.first_name, project.profile.last_name].filter(Boolean).join(" ").trim();
    }
    return project.profile?.username?.split("@")[0] || project.profile?.email_address?.split("@")[0] || "Unknown user";
  };

  const handleSort = (key: keyof Project) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleTagClick = async (e: React.MouseEvent<HTMLElement>, tag: string) => {
    e.preventDefault();
    e.stopPropagation();

    const tagPath = `/tags/${encodeURIComponent(tag)}`;
    if (window.location.pathname === tagPath) {
      toast.dismiss();
      toast.info(
        <div className="relative flex flex-row items-center gap-2">
          <Image src="/images/mascot.png" alt="Code Minion" width={50} height={50} className="relative rounded-md" />
          <p>You are already on the <Badge>#{tag}</Badge> tag page silly</p>
        </div>
      );
      return;
    }

    setLoadingTag(tag);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await router.push(tagPath);
    } finally {
      setLoadingTag(null);
    }
  };

  const handleCategoryClick = async (e: React.MouseEvent<HTMLElement>, category: string) => {
    e.preventDefault();
    e.stopPropagation();

    const categoryPath = `/categories/${encodeURIComponent(category)}`;
    if (window.location.pathname === categoryPath) {
      toast.dismiss();
      toast.info(
        <div className="relative flex flex-row items-center gap-2">
          <Image src="/images/mascot.png" alt="Code Minion" width={50} height={50} className="relative rounded-md" />
          <p>You are already on this category silly</p>
        </div>
      );
      return;
    }

    setLoadingCategory(category);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await router.push(categoryPath);
    } finally {
      setLoadingCategory(null);
    }
  };

  const handleRowClick = async (project: Project) => {
    if (navigatingProjectId === project.id) return;
    setNavigatingProjectId(project.id);
    await router.push(`/projects/${project.slug}`);
  };

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (sortConfig.key === "created_at" || sortConfig.key === "updated_at") {
        const dateA = new Date(a[sortConfig.key] || 0).getTime();
        const dateB = new Date(b[sortConfig.key] || 0).getTime();
        return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
      }

      const valueA = a[sortConfig.key];
      const valueB = b[sortConfig.key];

      if (valueA == null && valueB == null) return 0;
      if (valueA == null) return sortConfig.direction === "asc" ? -1 : 1;
      if (valueB == null) return sortConfig.direction === "asc" ? 1 : -1;
      if (valueA < valueB) return sortConfig.direction === "asc" ? -1 : 1;
      if (valueA > valueB) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [projects, sortConfig]);

  const toggleColumnVisibility = (columnName: string) => {
    setHiddenColumns((current) => {
      const updated = current.includes(columnName)
        ? current.filter((col) => col !== columnName)
        : [...current, columnName];
      if (typeof window !== "undefined") {
        localStorage.setItem("projectTableHiddenColumns", JSON.stringify(updated));
      }
      return updated;
    });
  };

  const isColumnVisible = (key: string) => !hiddenColumns.includes(key);

  return (
    <div className="hidden md:block w-full cd-foundations" data-density="compact">
      <div className="w-full px-4 mb-8">
        <div className="mb-4 flex justify-end">
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowColumnSettings((s) => !s)} className="cursor-pointer">
              <Settings2 className="h-4 w-4 mr-2" />
              Columns
            </Button>
            {showColumnSettings && (
              <div className="absolute right-0 mt-2 p-2 bg-card rounded-md shadow-lg border z-50">
                {COLUMNS.filter((col) => !col.required).map((column) => (
                  <div key={column.key} className="flex items-center space-x-2 p-2">
                    <Checkbox
                      id={`col-${column.key}`}
                      checked={isColumnVisible(column.key)}
                      onCheckedChange={() => toggleColumnVisibility(column.key)}
                    />
                    <label htmlFor={`col-${column.key}`} className="text-sm cursor-pointer">
                      {column.label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-y-auto overflow-x-hidden w-full">
          <table className="responsive-table border-separate border-spacing-y-2 w-full">
            <thead className="sticky top-0 bg-background z-20">
              <tr>
                {COLUMNS.map(
                  (column) =>
                    isColumnVisible(column.key) && (
                      <th
                        key={column.key}
                        aria-sort={
                          sortConfig.key === (column.key === "creator" ? "profile" : column.key)
                            ? sortConfig.direction === "asc" ? "ascending" : "descending"
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(column.key === "creator" ? "profile" : (column.key as keyof Project))}
                          className="flex w-full min-h-9 items-center space-x-1 rounded-md px-2 cursor-pointer hover:bg-muted/50 transition-colors"
                        >
                          <span className="truncate">{column.label}</span>
                          {sortConfig.key === (column.key === "creator" ? "profile" : column.key) && (
                            <ChevronUp aria-hidden="true" className={`h-4 w-4 transition-transform flex-shrink-0 ${sortConfig.direction === "desc" ? "rotate-180" : ""}`} />
                          )}
                        </button>
                      </th>
                    )
                )}
                <th>
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((project) => {
                const isOwner = project.is_mine ?? project.user_id === userId;
                const isNavigating = navigatingProjectId === project.id;
                const cellOpacity = isNavigating ? DIM_OPACITY : 1;

                return (
                  <tr
                    key={project.id}
                    onClick={() => handleRowClick(project)}
                    className={`cursor-pointer relative hover:shadow-lg hover:shadow-primary/15 hover:bg-muted/30 hover:ring-1 hover:ring-primary/30 group border border-transparent ${ROW_HEIGHT}`}
                  >
                    {isColumnVisible("title") && (
                      <td className={`relative ${ROW_HEIGHT} align-middle p-0`} style={{ opacity: cellOpacity }}>
                        {isNavigating && (
                          <span className="absolute z-50 bg-background/60 flex items-center justify-center inset-0">
                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          </span>
                        )}
                        <div className="font-medium p-2 line-clamp-3 cd-wrap">
                          <Link href={`/projects/${project.slug}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {project.title}
                          </Link>
                        </div>
                      </td>
                    )}

                    {isColumnVisible("description") && (
                      <td className={`${ROW_HEIGHT} align-middle p-0`} style={{ opacity: cellOpacity }}>
                        <div className="p-2 text-sm text-muted-foreground line-clamp-3 cd-wrap">
                          {project.description || "No description provided"}
                        </div>
                      </td>
                    )}

                    {isColumnVisible("category") && (
                      <td className={`${ROW_HEIGHT} align-middle overflow-hidden`} style={{ opacity: cellOpacity }}>
                        <Link
                          href={`/categories/${encodeURIComponent(project.category)}`}
                          className="cd-project-card-chip cd-cat"
                          data-category={project.category}
                          aria-busy={loadingCategory === project.category || undefined}
                          onClick={(e) => handleCategoryClick(e, project.category)}
                        >
                          {loadingCategory === project.category && <span aria-hidden="true" className="cd-spinner animate-spin" />}
                          {PROJECT_CATEGORIES[project.category as ProjectCategory]?.label || project.category}
                        </Link>
                      </td>
                    )}

                    {isColumnVisible("tags") && (
                      <td className={`${ROW_HEIGHT} align-middle p-0`} style={{ opacity: cellOpacity }}>
                        <div className="flex flex-wrap gap-1 p-2">
                          {project.tags?.length ? (
                            project.tags.map((tag, i) => (
                              <Link
                                key={i}
                                href={`/tags/${encodeURIComponent(tag)}`}
                                className="cd-project-card-chip"
                                aria-busy={loadingTag === tag || undefined}
                                onClick={(e) => handleTagClick(e, tag)}
                              >
                                {loadingTag === tag && <span aria-hidden="true" className="cd-spinner animate-spin" />}
                                #{tag}
                              </Link>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm">No tags</span>
                          )}
                        </div>
                      </td>
                    )}

                    {isColumnVisible("creator") && (
                      <td className={`${ROW_HEIGHT} align-middle overflow-hidden`} style={{ opacity: cellOpacity }}>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            {project.profile?.profile_image_url ? (
                              <AvatarImage src={project.profile.profile_image_url} alt={getDisplayName(project)} />
                            ) : (
                              <AvatarFallback className="text-xs">{getInitials(getDisplayName(project))}</AvatarFallback>
                            )}
                          </Avatar>
                          <span className="text-sm truncate">{getDisplayName(project)}</span>
                        </div>
                      </td>
                    )}

                    {isColumnVisible("created_at") && (
                      <td className={`${ROW_HEIGHT} align-middle overflow-hidden`} style={{ opacity: cellOpacity }}>
                        {project.created_at ? <FormattedDate date={project.created_at} /> : <span>—</span>}
                      </td>
                    )}

                    <td className={`${ROW_HEIGHT} align-middle overflow-hidden`} style={{ opacity: cellOpacity }}>
                      <div className="flex items-center gap-2">
                        {/* F02: as on the card, signed-out visitors get the count, not the control. */}
                        {userId ? (
                          <FavoriteButton
                            isFavorite={!!project.isFavorite}
                            count={Number(project.total_favorites) || 0}
                            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(project.id, !project.isFavorite); }}
                            ariaLabel={project.isFavorite ? "Remove from favorites" : "Add to favorites"}
                          />
                        ) : (
                          Number(project.total_favorites) > 0 && (
                            <div className="flex items-center gap-1">
                              <Heart size={20} fill="currentColor" className="text-red-500" />
                              <span className="text-xs text-muted-foreground">{Number(project.total_favorites)}</span>
                            </div>
                          )
                        )}
                        {isOwner && (
                          <>
                            <Button variant="ghost" size="icon" aria-label={`Update project ${project.title}`} onClick={(e) => { e.stopPropagation(); onUpdateProject?.(project); }}>
                              <Edit className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="icon" className="hover:text-destructive" aria-label={`Delete project ${project.title}`} onClick={(e) => { e.stopPropagation(); onDeleteProject?.(project.id); }}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
