"use client";

// UI06.1: the project card on the UI03 foundations. The card carries its own
// .cd-foundations scope, like the shell parts do, so it looks the same on
// every list that shows it. The title is a real link that covers the card
// (open in a new tab works, and keyboard users reach it first); every other
// control sits above that link. Behavior is unchanged: the same routes, the
// same sign-in messages, the same owner and graveyard rules.
import "@/styles/foundations.css";
import React, { useMemo, useState, useEffect } from "react";
import Link, { useLinkStatus } from "next/link";
import { Project } from "@/types/models/project";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Heart,
  Trash2,
  Edit,
  User,
  Undo2,
  Share2,
  Github,
  FileText,
  Video,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useViewerId } from "@/components/auth/AuthGate";
import { useRouter } from "next/navigation";
import {
  permanentlyDeleteProject,
  restoreProject,
} from "@/app/actions/projects";
import { toast } from "sonner";
import { PermanentDeleteConfirmationModal } from "./PermanentDeleteConfirmationModal";
import { RestoreProjectConfirmationModal } from "./RestoreProjectConfirmationModal";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { getInitials } from "@/utils/stringUtils";
import { FavoriteButton } from "./FavoriteButton";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectLink } from "@/types/project-links";
import { MAX_TAGS_ON_CARD_DESKTOP, MAX_TAGS_ON_CARD_MOBILE } from "@/constants/project-limits";
import { getProjectCoverImageAction } from "@/app/actions/project-images";
import { SelectProjectImage } from "@/types/project-images";

interface ProjectCardProps {
  project: Project;
  onViewDetails?: (id: string) => void;
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
  onDeleteProject?: (id: string, isPermanent?: boolean) => void;
  onUpdateProject?: (project: Project) => void;
  isFavorite?: boolean;
  hideActions?: boolean;
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span aria-hidden="true" className={`${className} inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent`} />;
}

/** Shown over the card while the title link's navigation is pending. */
function CardPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="cd-project-card-pending" role="status">
      <Spinner className="h-6 w-6" />
      <span className="sr-only">Opening project</span>
    </span>
  );
}

/** The View Project label, with a spinner while its navigation is pending. */
function ViewProjectLabel({ title }: { title: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <>
      <Spinner />
      Loading...
    </>
  ) : (
    <>
      View Project<span className="sr-only">: {title}</span>
    </>
  );
}

/** A chip's spinner while its navigation is pending. */
function ChipPending() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className="h-3 w-3" /> : null;
}

const mascotToast = (message: React.ReactNode, kind: "info" | "success" | "error" = "info") => {
  toast.dismiss();
  toast[kind](
    <div className="relative flex flex-row items-center gap-2">
      <Image src="/images/mascot.png" alt="Code Minion" width={50} height={50} className="relative rounded-md" />
      {typeof message === "string" ? <p>{message}</p> : message}
    </div>
  );
};

/** True for a plain left click; modified clicks open a tab and shouldn't be intercepted. */
const isPlainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const ProjectCard = React.memo(
  function ProjectCard({
    project,
    onToggleFavorite,
    onDeleteProject,
    onUpdateProject,
    isFavorite = false,
    hideActions = false,
  }: ProjectCardProps) {
    // D03: the session's user; Convex rows say is_mine.
    const userId = useViewerId();
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [showAllTags, setShowAllTags] = useState(false);
    const [isNavigatingUser, setIsNavigatingUser] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [coverImage, setCoverImage] = useState<SelectProjectImage | null>(null);
    const [coverFailed, setCoverFailed] = useState(false);

    // Check if current user is the owner
    const isOwner = project.is_mine ?? project.user_id === userId;
    // A graveyard project seen by someone else can't be opened (unchanged rule).
    const lockedDeleted = !!project.deleted_at && !isOwner;
    const projectHref = `/projects/${project.slug}`;

    // Fetch cover image for the project
    useEffect(() => {
      const fetchCoverImage = async () => {
        if (!project.id) return;
        try {
          const result = await getProjectCoverImageAction(project.id);
          if (result.success && result.data) {
            setCoverImage(result.data);
            setCoverFailed(false);
          }
        } catch (error) {
          // Silently fail - will show emoji fallback
          console.error("Error fetching cover image:", error);
        }
      };
      fetchCoverImage();
    }, [project.id]);

    useEffect(() => {
      const checkScreenSize = () => {
        setIsMobile(window.innerWidth < 400);
      };

      checkScreenSize();
      window.addEventListener("resize", checkScreenSize);
      return () => window.removeEventListener("resize", checkScreenSize);
    }, []);

    // This is the number of tags that will be shown on the card
    // If there are more than this number of tags, a "+N" button will be displayed
    const tagShowLimitOnCard: number = isMobile ? MAX_TAGS_ON_CARD_MOBILE : MAX_TAGS_ON_CARD_DESKTOP;

    // Handle permanent deletion
    const handlePermanentDelete = async (e: React.MouseEvent) => {
      if (!isOwner) return;
      e.stopPropagation();
      setShowPermanentDeleteModal(true);
    };

    const handlePermanentDeleteConfirm = async () => {
      if (!userId || !isOwner) return;
      setIsDeleting(true);

      try {
        const result = await permanentlyDeleteProject(project.id, userId);
        setShowPermanentDeleteModal(false);

        if (result.success) {
          // Remove from current list immediately
          if (onDeleteProject) {
            onDeleteProject(project.id, true);
          }
          mascotToast("Project permanently deleted!", "success");
        } else {
          mascotToast(result.error || "Failed to delete project permanently", "error");
        }
      } catch (error) {
        console.error("Error permanently deleting project:", error);
        toast.error("An error occurred while deleting the project");
      } finally {
        setIsDeleting(false);
      }
    };

    // Handle restoration
    const handleRestore = async (e: React.MouseEvent) => {
      if (!isOwner) return;
      e.stopPropagation();
      setShowRestoreModal(true);
    };

    const handleRestoreConfirm = async () => {
      if (!userId || !isOwner) return;
      setIsRestoring(true);

      try {
        const result = await restoreProject(project.id, userId);
        setShowRestoreModal(false);

        if (result.success) {
          // Remove from current list immediately
          if (onDeleteProject) {
            onDeleteProject(project.id, true);
          }
          toast.dismiss();
          toast.success(
            <div className="relative flex flex-row items-center gap-2">
              <Image
                src="/images/mascot.png"
                alt="Code Details Mascot"
                width={50}
                height={50}
                className="relative rounded-md"
              />
              <p>Project restored successfully </p>
            </div>
          );
        } else {
          toast.error(result.error || "Failed to restore project");
        }
      } catch (error) {
        console.error("Error restoring project:", error);
        toast.error("An error occurred while restoring the project");
      } finally {
        setIsRestoring(false);
      }
    };

    // Handle delete button click
    const handleDeleteClick = (e: React.MouseEvent) => {
      if (!isOwner) return;
      e.stopPropagation();
      if (onDeleteProject) {
        onDeleteProject(project.id, false);
      }
    };

    // Safely handle tags array (could be undefined or null after migration)
    const tags = useMemo(() => {
      return project.tags || [];
    }, [project.tags]);

    // Check if we can navigate to the user profile (has valid username)
    const canNavigateToUser = !!project.profile?.username;

    // Display username logic
    const displayUsername = useMemo(() => {
      // First try full name
      if (project.profile?.full_name) {
        return project.profile.full_name;
      }

      // Then try to combine first and last name if either exists
      if (project.profile?.first_name || project.profile?.last_name) {
        return [project.profile.first_name, project.profile.last_name]
          .filter(Boolean) // Remove null/undefined values
          .join(" ")
          .trim();
      }

      // Fall back to username or email
      return (
        project.profile?.username?.split("@")[0] ||
        project.profile?.email_address?.split("@")[0] ||
        "Unknown user"
      );
    }, [project.profile]);

    // Get initials for the avatar fallback
    const userInitials = useMemo(() => {
      // Try to get initials from full name first, then username, then email
      const nameForInitials =
        project.profile?.full_name ||
        project.profile?.username?.split("@")[0] ||
        project.profile?.email_address?.split("@")[0] ||
        "??";
      return getInitials(nameForInitials);
    }, [project.profile]);

    // Get consistent random emoji for project placeholder
    const projectEmoji = useMemo(() => {
      const emojis = [
        "🎨", "🚀", "💡", "⚡", "🔥", "✨", "🌟", "💻",
        "🎯", "🎪", "🎭", "🎬", "🎮", "🎲", "🎰", "🎸",
        "🎹", "🎺", "🎻", "🎼", "🔮", "💎", "🏆", "🚁",
        "🛸", "🌈", "🦄", "🐉", "🦋", "🌺", "🌸", "🍄"
      ];
      // Use project ID to get consistent emoji
      const hash = project.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return emojis[hash % emojis.length];
    }, [project.id]);

    const categoryLabel = PROJECT_CATEGORIES[project.category]?.label || project.category;
    const categoryHref = `/categories/${encodeURIComponent(project.category)}`;

    // Tag and category chips are links; on their own page they explain instead of reloading.
    const handleTagClick = (e: React.MouseEvent, tag: string) => {
      e.stopPropagation();
      if (window.location.pathname !== `/tags/${encodeURIComponent(tag)}`) return;
      e.preventDefault();
      mascotToast(
        <div>
          {"You are already looking at projects tagged with "}
          <Badge>
            {"#"}
            {tag}
          </Badge>
          {" you silly goose"}
        </div>
      );
    };

    const handleCategoryClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (window.location.pathname !== categoryHref) return;
      e.preventDefault();
      mascotToast(
        <div>
          {"You are already looking at projects in the "}
          <Badge className="bg-muted-foreground button-ghost">
            {PROJECT_CATEGORIES[project.category]?.label}
          </Badge>
          {" category you silly goose"}
        </div>
      );
    };

    const handleNavigateUser = async (e: React.MouseEvent) => {
      e.stopPropagation();
      // D07x: the session decides (Clerk's userId by default), so a Better
      // Auth user isn't told to sign in.
      if (!userId) {
        mascotToast(`You have to sign in to view ${project.profile?.full_name}'s profile page`);
        return;
      }
      const username = project.profile?.username;
      if (isNavigatingUser || !username) return;
      setIsNavigatingUser(true);
      try {
        router.push(`/users/${encodeURIComponent(username)}`);
      } finally {
        setIsNavigatingUser(false);
      }
    };

    const handleNavigatetoUsersProjects = async (e: React.MouseEvent) => {
      e.stopPropagation();
      // D07x: the session decides (Clerk's userId by default), so a Better
      // Auth user isn't told to sign in.
      if (!userId) {
        mascotToast(`You have to sign in to view ${project.profile?.full_name}'s projects`);
        return;
      }
      const username = project.profile?.username;
      if (isNavigatingUser || !username) return;
      setIsNavigatingUser(true);
      try {
        router.push(`/projects/users/${encodeURIComponent(username)}`);
      } finally {
        setIsNavigatingUser(false);
      }
    };

    const handleShareClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      const shareUrl = `${window.location.origin}/projects/${encodeURIComponent(
        project.slug || ""
      )}`;
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          toast.dismiss();
          toast.success(
            <div className="abosolute flex flex-row items-center justify-items-center gap-2 p-1 hover:p-1 w-auto">
              <Image
                src="/images/mascot.png"
                alt="Code Minion"
                width={50}
                height={50}
                className="relative flex item-center"
              />
              <div className="flex flex-col w-auto">
                <p className="text-foreground w-full">
                  {"Project copied to your clipboard!"}
                </p>
                <p className="text-muted-foreground w-full">{`"${shareUrl}"`}</p>
              </div>
              <ExternalLink
                size={30}
                className="text-muted-foreground ml-2 hover:cursor-pointer cursor-pointer"
                onClick={() => {
                  window.open(`/projects/${project.slug}`, "_blank");
                }}
              />
            </div>
          );
        })
        .catch(() => {
          toast.error("Failed to copy share link");
        });
    };

    const links = (project.url_links as ProjectLink[] | null | undefined) ?? [];
    const hasLink = (type: ProjectLink["type"]) => links.some((link) => link.type === type && link.url);
    const linkBadges = [
      { type: "repository" as const, Icon: Github, label: "Repository available" },
      { type: "demo" as const, Icon: ExternalLink, label: "Live demo available" },
      { type: "documentation" as const, Icon: FileText, label: "Documentation available" },
      { type: "video" as const, Icon: Video, label: "Video demo available" },
    ].filter((b) => hasLink(b.type));

    const visibleTags = showAllTags ? tags : tags.slice(0, tagShowLimitOnCard);
    const hiddenTagCount = tags.length - tagShowLimitOnCard;
    const showCover = !!coverImage?.storage_url && !coverFailed;
    const favoriteCount = Number(project.total_favorites) || 0;

    return (
      <>
        <article
          data-project-card
          data-category={project.category}
          className={`cd-foundations cd-project-card project-card ${project.deleted_at ? "deleted" : ""} ${lockedDeleted ? "cd-project-card-locked" : ""}`}
        >
          {/* Cover image, or the project's emoji when it has none or it fails to load */}
          <div className="cd-project-card-media">
            {showCover ? (
              <Image
                src={coverImage!.storage_url}
                alt={coverImage!.alt_text || ""}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, 360px"
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <span aria-hidden="true" className="cd-project-card-emoji">
                {projectEmoji}
              </span>
            )}
          </div>

          <div className="cd-project-card-body">
            <div className="cd-project-card-meta">
              <div className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
                <Link
                  href={categoryHref}
                  onClick={handleCategoryClick}
                  className="cd-project-card-chip cd-cat"
                  data-category={project.category}
                >
                  <ChipPending />
                  {categoryLabel}
                </Link>
                {linkBadges.map(({ type, Icon, label }) => (
                  <Tooltip key={type}>
                    <TooltipTrigger asChild>
                      <span role="img" aria-label={label} className="cd-project-card-indicator">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{label}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>

              {/* Action buttons */}
              <div className="cd-project-card-actions">
                {!project.deleted_at && !hideActions ? (
                  <>
                    {isOwner && onUpdateProject && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cd-project-card-icon action-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject?.(project);
                        }}
                        aria-label="Update project"
                      >
                        <Edit className="h-[18px] w-[18px]" aria-hidden="true" />
                      </Button>
                    )}
                    {isOwner && onDeleteProject && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cd-project-card-icon cd-project-card-danger action-button"
                        onClick={handleDeleteClick}
                        aria-label="Delete project"
                      >
                        <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
                      </Button>
                    )}
                    {/* D05: the favorite controls follow the session (useViewerId), so they work under the Better Auth switch. */}
                    {userId && (
                      <FavoriteButton
                        isFavorite={!!isFavorite}
                        count={favoriteCount}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          if (!userId) {
                            toast.info("You have to sign in to favorite projects silly");
                            return;
                          }
                          onToggleFavorite?.(project.id, !isFavorite);
                        }}
                        ariaLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
                      />
                    )}
                    {!userId && favoriteCount > 0 && (
                      <span className="cd-project-card-favorites cd-small cd-number">
                        <Heart size={18} fill="currentColor" aria-hidden="true" />
                        {favoriteCount}
                        <span className="sr-only">{favoriteCount === 1 ? " favorite" : " favorites"}</span>
                      </span>
                    )}
                  </>
                ) : lockedDeleted ? (
                  // Soft-deleted project viewed by non-owner: show graveyard badge and unfavorite button
                  <>
                    <span className="cd-status" data-tone="danger">
                      <span aria-hidden="true">🪦 </span>In Graveyard
                    </span>
                    {isFavorite && userId && onToggleFavorite && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(project.id, false);
                        }}
                      >
                        Unfavorite
                      </Button>
                    )}
                  </>
                ) : (
                  isOwner && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cd-project-card-icon action-button"
                        onClick={handleRestore}
                        aria-label="Restore project"
                      >
                        <Undo2 className="h-[18px] w-[18px]" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cd-project-card-icon cd-project-card-danger action-button"
                        onClick={handlePermanentDelete}
                        aria-label="Permanently delete project"
                      >
                        <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
                      </Button>
                    </>
                  )
                )}
              </div>
            </div>

            <h3 className="cd-subheading cd-wrap cd-project-card-title">
              {lockedDeleted ? (
                project.title
              ) : (
                <Link href={projectHref} className="cd-project-card-link">
                  {project.title}
                  <CardPending />
                </Link>
              )}
            </h3>

            <p className={`cd-small cd-wrap cd-project-card-description ${project.description ? "" : "cd-muted"}`}>
              {project.description || "No description provided"}
            </p>

            {tags.length > 0 ? (
              <ul className="cd-project-card-tags" aria-label="Tags">
                {visibleTags.map((tag, index) => (
                  <li key={index} className="min-w-0">
                    <Link
                      href={`/tags/${encodeURIComponent(tag)}`}
                      onClick={(e) => handleTagClick(e, tag)}
                      className="cd-project-card-chip tag-badge"
                    >
                      <ChipPending />
                      <span className="cd-wrap">#{tag}</span>
                    </Link>
                  </li>
                ))}
                {!showAllTags && hiddenTagCount > 0 && (
                  <li>
                    <button
                      type="button"
                      className="cd-project-card-chip cd-project-card-more"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAllTags(true);
                      }}
                      aria-label={`Show ${hiddenTagCount} more ${hiddenTagCount === 1 ? "tag" : "tags"}`}
                    >
                      +{hiddenTagCount}
                    </button>
                  </li>
                )}
                {showAllTags && hiddenTagCount > 0 && (
                  <li>
                    <button
                      type="button"
                      className="cd-project-card-chip cd-project-card-more"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAllTags(false);
                      }}
                    >
                      Show fewer tags
                    </button>
                  </li>
                )}
              </ul>
            ) : (
              <p className="cd-caption">No tags added</p>
            )}
          </div>

          {lockedDeleted && (
            <p className="cd-caption cd-project-card-note">This project was sent to the owner&apos;s graveyard</p>
          )}

          <div className="cd-project-card-footer">
            {/* The owner: one control for the avatar and the name */}
            {canNavigateToUser ? (
              <button
                type="button"
                disabled={isNavigatingUser}
                onClick={lockedDeleted ? handleNavigatetoUsersProjects : handleNavigateUser}
                className="cd-project-card-owner"
                title={lockedDeleted ? `Browse ${displayUsername}'s projects` : `View ${displayUsername}'s profile`}
              >
                <Avatar className="h-8 w-8 shrink-0" aria-hidden="true">
                  {project.profile?.profile_image_url ? (
                    <AvatarImage src={project.profile.profile_image_url} alt="" />
                  ) : null}
                  <AvatarFallback className="cd-project-card-initials">
                    {userInitials || <User className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{displayUsername}</span>
                {lockedDeleted && <span className="sr-only">, browse their projects</span>}
              </button>
            ) : (
              <span className="cd-project-card-owner cd-muted" title="User no longer exists">
                <Avatar className="h-8 w-8 shrink-0" aria-hidden="true">
                  <AvatarFallback className="cd-project-card-initials">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{displayUsername}</span>
              </span>
            )}

            {/* Share and View Project - not for non-owners of deleted projects */}
            {!lockedDeleted && (
              <div className="cd-project-card-actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="cd-project-card-icon action-button"
                      onClick={handleShareClick}
                      aria-label="Share project"
                    >
                      <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copy project link to clipboard</p>
                  </TooltipContent>
                </Tooltip>
                <Button asChild size="sm">
                  <Link href={projectHref} onClick={(e) => isPlainClick(e) && e.stopPropagation()}>
                    <ViewProjectLabel title={project.title} />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </article>

        {/* Confirmation Modals */}
        <PermanentDeleteConfirmationModal
          isOpen={showPermanentDeleteModal}
          onClose={() => setShowPermanentDeleteModal(false)}
          onConfirm={handlePermanentDeleteConfirm}
          projectTitle={project.title}
          isDeleting={isDeleting}
        />

        <RestoreProjectConfirmationModal
          isOpen={showRestoreModal}
          onClose={() => setShowRestoreModal(false)}
          onConfirm={handleRestoreConfirm}
          projectTitle={project.title}
          isRestoring={isRestoring}
        />
      </>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison function that only re-renders when necessary props change
    return (
      prevProps.project.id === nextProps.project.id &&
      prevProps.project.title === nextProps.project.title &&
      prevProps.project.description === nextProps.project.description &&
      prevProps.isFavorite === nextProps.isFavorite &&
      JSON.stringify(prevProps.project.tags || []) ===
        JSON.stringify(nextProps.project.tags || []) &&
      prevProps.project.category === nextProps.project.category
    );
  }
);
