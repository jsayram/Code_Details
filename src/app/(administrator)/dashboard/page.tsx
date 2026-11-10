"use client";

// UI08.1: the dashboard on AppShell and the foundations. One main (the
// shell's), one h1, the same data and controls. Loading, empty and failed
// states are separate, and a failed refresh keeps the last data on screen
// with a note instead of replacing the page.
import "@/styles/foundations.css";
import React, { useState, useEffect } from "react";
import { scrollMotion } from "@/lib/reduced-motion";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useViewerId } from "@/components/auth/AuthGate";
import { useDisplayUser } from "@/components/auth/useDisplayUser";
import { getMyProfileHandle } from "@/app/actions/profile-handle";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Code,
  Heart,
  HeartCrack,
  Star,
  Tag as TagIcon,
  TrendingUp,
  RefreshCw,
  Activity,
  Sparkles,
  Loader2,
  RefreshCcw,
  ChevronDown,
  User,
  Edit,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/lib/FormattedDate";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useDashboardStats } from "@/hooks/use-dashboard-stats";
import Link from "next/link";
import Image from "next/image";
import { MAX_PROJECT_TAGS } from "@/constants/project-limits";
import { PROJECT_CATEGORIES, ProjectCategory } from "@/constants/project-categories";
import { UserDashboardStats } from "@/types/rows";
import { toast } from "sonner";
import { CreateFirstProjectPrompt } from "@/components/dashboard/CreateFirstProjectPrompt";
import { removeProjectFavorite } from "@/app/actions/projects";

// Type definitions
interface StatsCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}

interface ActivityItemProps {
  slug: string;
  title: string;
  description: string;
  timestamp: Date;
}

interface ProjectCardProps {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  total_favorites: number;
  category: string;
  tags?: string[];
  created_at?: Date | null;
}

interface FavoriteCardProps {
  id: string;
  slug: string;
  title: string;
  owner_username: string | null;
  owner_user_id: string | null;
  category: string;
  deleted_at: Date | null;
  tags: string[];
}

interface TagSubmissionCardProps {
  tag_name: string;
  project_id: string | null;
  project_slug: string;
  project_title: string;
  project_deleted_at: Date | null;
  status: string;
  admin_notes: string | null;
  created_at: Date | null;
  is_now_available: boolean;
  project_tag_count: number;
  is_on_original_project?: boolean;
  other_projects_using_tag?: { slug: string; title: string }[];
}

interface RecentAppreciationItemProps {
  project_slug: string;
  project_title: string;
  favoriter_username: string | null;
  favoriter_profile_image: string | null;
  favorited_at: Date | null;
}



// Simple stats card component
function StatsCard({ title, value, description, icon }: StatsCardProps) {
  return (
    <Card className="h-[250px] flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center items-center">
        <div className="text-5xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-2 text-center">{description}</p>
      </CardContent>
    </Card>
  );
}

// My Projects card component with button
function MyProjectsCard({ totalProjects, activeThisWeek }: { totalProjects: number; activeThisWeek: number }) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Card className="stat-card flex flex-col gap-3 py-5 lg:h-[250px]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0 flex-shrink-0">
        <CardTitle className="cd-small font-medium">My Projects</CardTitle>
        <Code className="h-4 w-4" aria-hidden="true" style={{ color: "var(--cd-action)" }} />
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center items-center">
        <p className="cd-number text-4xl lg:text-5xl font-semibold">{totalProjects}</p>
        <p className="cd-caption mt-2 text-center">{activeThisWeek} updated this week</p>
        <Button asChild variant="outline" size="sm" className="mt-3 w-full">
          <Link href="/projects/projects-portfolio" onClick={() => setIsNavigating(true)}>
            {isNavigating && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />}
            View All Projects
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Favorite project item component
function FavoriteProjectItem({ project }: { project: { id: string; slug: string; title: string; total_favorites: number } }) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="block rounded-md hover:bg-muted/50 transition-colors"
      onClick={() => setIsNavigating(true)}
    >
      <span className="cd-small p-2 flex items-center justify-between gap-2 min-h-11 lg:min-h-0">
        <span className="truncate flex-1">{project.title}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {isNavigating && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          <Heart className="h-3 w-3" aria-hidden="true" />
          <span className="cd-number font-medium">{project.total_favorites}</span>
          <span className="sr-only">{project.total_favorites === 1 ? " favorite" : " favorites"}</span>
        </span>
      </span>
    </Link>
  );
}

// Favorites Received card component with project list
function FavoritesReceivedCard({ 
  totalFavorites, 
  projectsWithFavorites 
}: { 
  totalFavorites: number; 
  projectsWithFavorites: { id: string; slug: string; title: string; total_favorites: number }[] 
}) {
  return (
    <Card className="flex flex-col gap-3 py-5 lg:h-[250px]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0 flex-shrink-0">
        <CardTitle className="cd-small font-medium">Favorites Received</CardTitle>
        <Heart className="h-4 w-4" aria-hidden="true" style={{ color: "var(--cd-action)" }} />
      </CardHeader>
      <CardContent className="flex-1 flex flex-row gap-3 min-h-0">
        {/* Left side - Total count */}
        <div className="flex flex-col items-center justify-center flex-shrink-0 w-1/3 border-r pr-3" style={{ borderColor: "var(--cd-border-subtle)" }}>
          <p className="cd-number text-4xl font-semibold">{totalFavorites}</p>
          <p className="cd-caption mt-1 text-center">Total</p>
        </div>

        {/* Right side - the projects that received them, scrolling inside the card on wide screens */}
        <div className="flex-1 min-w-0 flex flex-col">
          {projectsWithFavorites.length > 0 ? (
            <div
              role="region"
              aria-label="Projects with favorites"
              tabIndex={0}
              className="flex-1 max-h-48 lg:max-h-none overflow-y-auto overscroll-contain pr-1"
            >
              <ul className="space-y-1">
                {projectsWithFavorites.map((project) => (
                  <li key={project.id}><FavoriteProjectItem project={project} /></li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="cd-caption text-center">No projects have received favorites yet</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Favorites Given card component with button
function FavoritesGivenCard({ totalFavoritesGiven }: { totalFavoritesGiven: number }) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Card className="flex flex-col gap-3 py-5 lg:h-[250px]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0 flex-shrink-0">
        <CardTitle className="cd-small font-medium">Favorites Given</CardTitle>
        <Star className="h-4 w-4" aria-hidden="true" style={{ color: "var(--cd-action)" }} />
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center items-center">
        <p className="cd-number text-4xl lg:text-5xl font-semibold">{totalFavoritesGiven}</p>
        <p className="cd-caption mt-2 text-center">Projects you&apos;ve favorited ❤️</p>
        <Button asChild variant="outline" size="sm" className="mt-3 w-full">
          <Link href="/projects/favorites" onClick={() => setIsNavigating(true)}>
            {isNavigating && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />}
            View All Favorites
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Tags card component showing all tags
interface TagsCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  tags: { name: string }[];
}

function TagsCard({ title, value, icon, tags }: TagsCardProps) {
  return (
    <Card className="flex flex-col gap-3 py-5 lg:h-[250px]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0 flex-shrink-0">
        <CardTitle className="cd-small font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="flex-1 flex flex-row gap-4 min-h-0">
        {/* Left side - Total count */}
        <div className="flex flex-col items-center justify-center flex-shrink-0 w-1/3 border-r pr-3" style={{ borderColor: "var(--cd-border-subtle)" }}>
          <p className="cd-number text-4xl lg:text-5xl font-semibold">{value}</p>
          <p className="cd-caption mt-2 text-center">
            Unique tags
          </p>
        </div>

        {/* Right side - the tags, scrolling inside the card on wide screens */}
        <div className="flex-1 min-w-0 flex flex-col">
          {tags && tags.length > 0 ? (
            <div
              role="region"
              aria-label="My tags"
              tabIndex={0}
              className="flex-1 max-h-48 lg:max-h-none overflow-y-auto overscroll-contain pr-1"
            >
              <ul className="flex flex-wrap gap-1.5 content-start">
                {tags.map((tag, index) => (
                  <li key={`${tag.name}-${index}`} className="cd-tag cd-caption rounded-full" style={{ color: "var(--cd-text)" }}>
                    #{tag.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="cd-caption">No tags yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Activity item component
function ActivityItem({
  slug,
  title,
  description,
  timestamp,
}: ActivityItemProps) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Link
      href={`/projects/${slug}`}
      className="block rounded-lg hover:bg-muted/50 transition-colors"
      onClick={() => setIsNavigating(true)}
    >
      <span className="flex flex-col gap-1 p-2">
        <span className="flex flex-wrap items-center justify-between gap-x-2">
          <span className="flex items-center gap-2 min-w-0 flex-1">
            {isNavigating && <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" aria-hidden="true" />}
            <span className="cd-small font-medium truncate">
              {title}
            </span>
          </span>
          <span className="cd-caption flex-shrink-0">
            <FormattedDate date={timestamp} format="datetime" />
          </span>
        </span>
        <span className="cd-caption line-clamp-2">{description}</span>
      </span>
    </Link>
  );
}

// Popular tag project item component
function PopularTagProjectItem({
  project,
}: {
  project: { id: string; slug: string; title: string };
}) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="block rounded-md hover:bg-muted/50 transition-colors"
      onClick={() => setIsNavigating(true)}
    >
      <span className="cd-small p-2 flex items-center gap-1 min-w-0 min-h-11 lg:min-h-0">
        {isNavigating && (
          <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{project.title}</span>
      </span>
    </Link>
  );
}

// Single-use tag item component
function SingleUseTagItem({
  tag,
}: {
  tag: {
    name: string;
    count: number;
    projects: { id: string; slug: string; title: string }[];
  };
}) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors gap-2 min-w-0">
      <span className="cd-small font-medium truncate min-w-0">#{tag.name}</span>
      {tag.projects && tag.projects.length > 0 && (
        <Link
          href={`/projects/${tag.projects[0].slug}`}
          className="cd-link cd-small ml-2 inline-flex items-center gap-1 min-w-0 flex-shrink-0 max-w-[50%] min-h-11 lg:min-h-0"
          onClick={() => setIsNavigating(true)}
        >
          {isNavigating && (
            <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
          )}
          <span className="truncate">{tag.projects[0].title}</span>
        </Link>
      )}
    </div>
  );
}

// Project card component
function ProjectCard({
  slug,
  title,
  description,
  total_favorites,
  category,
  tags = [],
  created_at,
}: ProjectCardProps) {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Link
      href={`/projects/${slug}`}
      className="block h-full rounded-[var(--cd-radius-surface)]"
      onClick={() => setIsNavigating(true)}
    >
      <Card className="hover:bg-accent/40 transition-colors relative min-h-36 h-full sm:h-[200px] 3xl:h-[440px] flex flex-col gap-0 py-0">
        {isNavigating && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg z-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        <span className="absolute top-3 left-3 cd-tag cd-cat cd-caption rounded-full border max-w-[60%] truncate" data-category={category}>
          {PROJECT_CATEGORIES[category as ProjectCategory]?.label || category}
        </span>
        {created_at && (
          <span className="absolute top-3 right-3 flex flex-col items-end gap-1 cd-caption">
            <FormattedDate date={created_at} />
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" aria-hidden="true" style={total_favorites > 0 ? { color: "var(--cd-danger)", fill: "var(--cd-danger)" } : undefined} />
              {total_favorites}
              <span className="sr-only">{total_favorites === 1 ? " favorite" : " favorites"}</span>
            </span>
          </span>
        )}
        <CardHeader className="flex-1 min-h-0 pb-4 pt-14 px-4 overflow-hidden">
          <div className="flex items-start justify-between h-full overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden w-full">
              <div className="overflow-hidden w-full">
                <CardTitle className="text-base font-semibold line-clamp-2 mb-3 cd-wrap" title={title}>{title}</CardTitle>
              </div>
              {tags && tags.length > 0 && (
                <span className="flex flex-wrap gap-1.5 overflow-hidden">
                  {tags.slice(0, 3).map((tag, index) => (
                    <span
                      key={index}
                      className="cd-tag cd-caption rounded-full truncate max-w-[8rem]"
                      style={{ color: "var(--cd-text)" }}
                      title={tag}
                    >
                      #{tag}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="cd-tag cd-caption rounded-full" style={{ color: "var(--cd-text)" }}>
                      +{tags.length - 3}
                      <span className="sr-only"> more tags</span>
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

// Favorite card component
function FavoriteCard({
  id,
  slug,
  title,
  owner_username,
  owner_user_id,
  category,
  deleted_at,
  tags,
}: FavoriteCardProps) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [isUnfavoriting, setIsUnfavoriting] = useState(false);
  // D08g4e3: the app's login, so unfavoriting works under Better Auth too (it
  // read Clerk's user and silently did nothing). The action takes the user
  // from the session; the ID is ignored.
  const viewerId = useViewerId();
  const isDeleted = deleted_at !== null;

  const handleUnfavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!viewerId || !id) return;
    
    setIsUnfavoriting(true);
    try {
      const result = await removeProjectFavorite(id, viewerId);
      
      if (result.success) {
        toast.success("Removed from favorites");
        // Refresh the dashboard
        window.location.reload();
      } else {
        toast.error(result.error || "Failed to remove favorite");
      }
    } catch (error) {
      console.error("Error unfavoriting:", error);
      toast.error("Failed to remove favorite");
    } finally {
      setIsUnfavoriting(false);
    }
  };

  // For deleted projects, show limited interaction card
  if (isDeleted) {
    return (
      <div className="relative min-h-40 h-full sm:h-[250px] 3xl:h-[490px]">
        <Card className="relative h-full flex flex-col gap-0 py-0 border-dashed" style={{ borderColor: "var(--cd-danger)", background: "var(--cd-raised)" }}>
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 z-10">
            <span className="cd-tag cd-caption rounded-full flex-shrink-0" style={{ color: "var(--cd-text)" }}>
              {PROJECT_CATEGORIES[category as ProjectCategory]?.label || category}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex items-center gap-1 flex-shrink-0"
              style={{ color: "var(--cd-danger)" }}
              onClick={handleUnfavorite}
              disabled={isUnfavoriting}
            >
              {isUnfavoriting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <HeartCrack className="h-3 w-3" aria-hidden="true" />}
              <span>Unfavorite</span>
            </Button>
          </div>
          <CardHeader className="flex-1 min-h-0 pb-2 pt-12 px-6 overflow-hidden">
            {owner_user_id && owner_username && (
              <div className="flex justify-center mb-2">
                <Button
                  variant="default"
                  size="sm"
                  className="font-semibold max-w-full truncate"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsNavigating(true);
                    window.location.href = `/users/${owner_username}`;
                  }}
                  title={`View ${owner_username}'s profile`}
                >
                  {isNavigating && <Loader2 className="h-3 w-3 animate-spin mr-1.5 flex-shrink-0" />}
                  <span className="truncate">
                    {owner_username.length > 20 ? 'User Projects' : owner_username}
                  </span>
                </Button>
              </div>
            )}
            <div className="mb-2 overflow-hidden">
              <CardTitle className="text-base cd-muted text-center truncate px-2" title={title}>
                {title}
              </CardTitle>
            </div>
            <div className="space-y-1 overflow-hidden">
              <div className="flex items-center justify-center gap-1.5 min-w-0 overflow-hidden flex-wrap">
                <span className="cd-status cd-caption flex-shrink-0" data-tone="danger">
                  🪦 In Graveyard
                </span>
                <span className="cd-caption italic text-center truncate max-w-full">
                  Project sent to owner&apos;s graveyard
                </span>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Normal active project card
  return (
    <Link
      href={`/projects/${slug}`}
      className="block h-full rounded-[var(--cd-radius-surface)]"
      onClick={() => setIsNavigating(true)}
    >
      <Card className="hover:bg-accent/40 transition-colors relative min-h-36 h-full sm:h-[250px] 3xl:h-[490px] flex flex-col gap-0 py-0">
        {isNavigating && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg z-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        <span className="absolute top-3 left-3 cd-tag cd-cat cd-caption rounded-full border max-w-[80%] truncate" data-category={category}>
          {PROJECT_CATEGORIES[category as ProjectCategory]?.label || category}
        </span>
        <CardHeader className="flex-1 min-h-0 pb-4 pt-14 px-4 overflow-hidden">
          <div className="flex items-start justify-between h-full overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden w-full">
              <div className="overflow-hidden w-full">
                <CardTitle className="text-base font-semibold mb-3 truncate w-full" title={title}>{title}</CardTitle>
              </div>
              <p className="cd-caption line-clamp-2 overflow-hidden">
                by {owner_username}
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

// Tag submission card
function TagSubmissionCard({
  tag_name,
  project_id,
  project_slug,
  project_title,
  project_deleted_at,
  status,
  admin_notes,
  created_at,
  is_now_available,
  project_tag_count,
  is_on_original_project,
  other_projects_using_tag,
}: TagSubmissionCardProps) {
  const [isNavigating, setIsNavigating] = useState(false);
  
  // Check if project is permanently deleted (no project_id) or soft-deleted
  const isPermanentlyDeleted = !project_id;
  const isInGraveyard = project_deleted_at !== null && !isPermanentlyDeleted;
  
  // UI08.1: the status tones from the foundations (the old black-on-green
  // and black-on-red badges failed contrast in light mode).
  const statusTone = status === "approved" ? "success" : status === "rejected" ? "danger" : "warning";

  const isProjectAtCapacity = project_tag_count >= MAX_PROJECT_TAGS;

  return (
    <div className="p-3 rounded-xl" style={{ background: "var(--cd-raised)" }}>
      <div className="flex flex-wrap items-start justify-between mb-2 gap-2">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="cd-status cd-caption cd-wrap" data-tone={statusTone}>
              #{tag_name}
            </span>
            {status === "approved" && !isPermanentlyDeleted && (
              is_on_original_project ? (
                <span className="cd-status cd-caption" data-tone="success">
                  ✅ Tag in one project
                </span>
              ) : (
                <span className="cd-status cd-caption" data-tone="warning">
                  ⚠️ Not in projects, but approved
                </span>
              )
            )}
            {isInGraveyard && (
              <span className="cd-status cd-caption" data-tone="danger">
                🪦 In Graveyard
              </span>
            )}
            {isPermanentlyDeleted && (
              <span className="cd-tag cd-caption rounded-full" style={{ color: "var(--cd-text)" }}>
                ⚰️ Project Deleted
              </span>
            )}
          </div>
          {!isPermanentlyDeleted ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-auto w-full px-3 py-1 text-left justify-start overflow-hidden"
            >
              <Link href={`/projects/${project_slug}`} onClick={() => setIsNavigating(true)}>
                {isNavigating && (
                  <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" aria-hidden="true" />
                )}
                <span className="truncate cd-caption" style={{ color: "inherit" }}>
                  Originally submitted for: {project_title}
                </span>
              </Link>
            </Button>
          ) : (
            <div className="px-2 py-1 cd-caption italic">
              Originally submitted for: {project_title}
            </div>
          )}
          {status === "approved" && other_projects_using_tag && other_projects_using_tag.length > 0 && (
            <div className="text-xs text-muted-foreground pt-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 cd-caption inline-flex items-center gap-1"
                  >
                    <span className="font-medium">Also used in:</span>
                    <span style={{ color: "var(--cd-action)" }}>{other_projects_using_tag.length} project{other_projects_using_tag.length > 1 ? 's' : ''}</span>
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="cd-foundations w-80 max-w-[calc(100vw-2rem)] border max-h-80 overflow-y-auto pr-2">
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Also used in these projects:
                  </DropdownMenuLabel>
                  {other_projects_using_tag.map((proj) => (
                    <DropdownMenuItem key={proj.slug} asChild className="cursor-pointer p-0">
                      <Link 
                        href={`/projects/${proj.slug}`}
                        className="flex items-center gap-2 px-2 py-2 text-sm w-full hover:bg-muted/30 rounded-sm"
                      >
                        <span className="flex-1 min-w-0 cd-wrap font-medium" style={{ color: "var(--cd-action)" }}>
                          {proj.title}
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {is_now_available && (
            <span className="cd-status cd-caption" data-tone="success">
              Now Available
            </span>
          )}
          {created_at && (
            <p className="cd-caption">
              <FormattedDate date={created_at} format="datetime" />
            </p>
          )}
        </div>
      </div>
      {status === "rejected" && admin_notes && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--cd-border-subtle)" }}>
          <p className="cd-caption" style={{ color: "var(--cd-danger)" }}>
            <span className="font-medium">Reason: </span>
            {admin_notes}
          </p>
        </div>
      )}
      {is_now_available && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--cd-border-subtle)" }}>
          {isProjectAtCapacity ? (
            <>
              <p className="cd-caption" style={{ color: "var(--cd-warning)" }}>
                <span className="font-medium">Tag is available,</span> but this
                project already has the maximum of {MAX_PROJECT_TAGS} tags.
                Remove a tag first to add this one.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link
                  href={`/projects/${project_slug}?edit=true&tag=${encodeURIComponent(
                    tag_name
                  )}`}
                  onClick={() => setIsNavigating(true)}
                >
                  {isNavigating && (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
                  )}
                  Manage Project Tags
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="cd-caption" style={{ color: "var(--cd-success)" }}>
                <span className="font-medium">Good news!</span> This tag was
                approved for use in the system after further consideration. You
                can add it to your project.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link
                  href={`/projects/${project_slug}?edit=true&tag=${encodeURIComponent(
                    tag_name
                  )}`}
                  onClick={() => setIsNavigating(true)}
                >
                  {isNavigating && (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
                  )}
                  Add to Project
                </Link>
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Recent Appreciation item component
function RecentAppreciationItem({
  project_slug,
  project_title,
  favoriter_username,
  favoriter_profile_image,
  favorited_at,
}: RecentAppreciationItemProps) {
  const [isNavigatingToUser, setIsNavigatingToUser] = useState(false);
  const [isNavigatingToProject, setIsNavigatingToProject] = useState(false);

  return (
    <div className="p-3 rounded-xl" style={{ background: "var(--cd-raised)" }}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {favoriter_profile_image ? (
            <Image
              src={favoriter_profile_image}
              alt={favoriter_username || "User"}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ background: "var(--cd-selected)" }} aria-hidden="true">
              <Heart className="h-5 w-5" style={{ color: "var(--cd-on-selected)" }} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="cd-small font-medium cd-wrap">
            {favoriter_username ? (
              <Link
                href={`/users/${favoriter_username}`}
                className="cd-link font-semibold inline-flex items-center gap-1 max-w-full"
                onClick={() => setIsNavigatingToUser(true)}
              >
                {isNavigatingToUser && (
                  <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                )}
                <span className="truncate">{favoriter_username}</span>
              </Link>
            ) : (
              <span className="font-semibold">Someone</span>
            )}
            <span className="cd-muted font-normal">
              {" "}
              favorited ❤️
            </span>
          </p>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-auto w-full px-3 py-1 text-left justify-start overflow-hidden whitespace-normal"
          >
            <Link href={`/projects/${project_slug}`} onClick={() => setIsNavigatingToProject(true)}>
              {isNavigatingToProject && (
                <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" aria-hidden="true" />
              )}
              <span className="line-clamp-2 cd-wrap min-w-0">{project_title}</span>
            </Link>
          </Button>
          {favorited_at && (
            <p className="cd-caption">
              <FormattedDate date={favorited_at} format="datetime" />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// View All Projects Button component
function ViewAllProjectsButton() {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <CardFooter className="flex-shrink-0 flex justify-center">
      <Button asChild className="w-auto px-6">
        <Link href="/projects" onClick={() => setIsNavigating(true)}>
          {isNavigating && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />}
          View All My Projects
        </Link>
      </Button>
    </CardFooter>
  );
}

// View All Favorites Button component
function ViewAllFavoritesButton() {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <CardFooter className="flex-shrink-0 flex justify-center">
      <Button asChild className="w-auto px-6">
        <Link href="/projects/favorites" onClick={() => setIsNavigating(true)}>
          {isNavigating && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
          )}
          View All Projects I&apos;ve Favorited ❤️
        </Link>
      </Button>
    </CardFooter>
  );
}

// Dashboard error component. UI08.1: a first load that fails says so, with
// Try again, inside the page; the server's own message isn't shown (it can
// carry internal wording). With older data on screen, a failed refresh is a
// note above that data instead (`stale`).
function DashboardError({
  refresh,
  stale = false,
}: {
  refresh: () => Promise<void>;
  stale?: boolean;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch {
      // A second failure keeps this message on screen; nothing else to do.
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      role="alert"
      className={stale ? "cd-surface flex flex-wrap items-center justify-between gap-4" : "cd-surface cd-empty"}
      style={{ borderColor: "var(--cd-danger)" }}
    >
      <div className={stale ? "cd-stack-tight min-w-0" : "cd-stack-tight items-center"}>
        <p className="cd-subheading">
          {stale ? "Couldn't refresh your dashboard" : "Your dashboard didn't load"}
        </p>
        <p className="cd-small cd-muted">
          {stale
            ? "What you see is from the last successful load."
            : "Check your connection and try again."}
        </p>
      </div>
      <Button onClick={handleRefresh} disabled={isRefreshing}>
        {isRefreshing && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />}
        {isRefreshing ? "Trying again..." : "Try again"}
      </Button>
    </div>
  );
}

// Dashboard content component
// Profile Editor Card Component
function ProfileEditorCard() {
  // D08g4e3: display fields from the app's login (Clerk's useUser values with
  // Clerk). DEF-G4E3-HANDLE: Better Auth gives the client no handle, so it
  // comes from the server for the session (getMyProfileHandle, no arguments).
  const { user } = useDisplayUser();
  // useDisplayUser returns a new object each render, so effects key on the
  // values (keying on the object reset the form on every keystroke; g4e3).
  const signedIn = !!user;
  const fullName = user?.fullName ?? null;
  const email = user?.email ?? null;
  const imageUrl = user?.imageUrl ?? null;
  const [sessionHandle, setSessionHandle] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void getMyProfileHandle().then((handle) => {
      if (live) setSessionHandle(handle);
    });
    return () => {
      live = false;
    };
  }, [signedIn]);
  const handle = user?.username || sessionHandle;
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // UI08.3: a failed save is shown in the form, not only in a toast, and
  // focus moves into the form on Edit and back to Edit Profile after it.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Only a rejected username (taken, or refused by validation) marks the
  // field invalid; a network or server failure isn't the field's fault.
  const [usernameRejected, setUsernameRejected] = useState(false);
  const editButtonRef = React.useRef<HTMLButtonElement>(null);
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const focusAfterRef = React.useRef<"form" | "edit" | null>(null);
  useEffect(() => {
    const target = focusAfterRef.current;
    focusAfterRef.current = null;
    if (target === "form") usernameRef.current?.focus();
    if (target === "edit") editButtonRef.current?.focus();
  }, [isEditing]);
  const startEditing = () => {
    setSaveError(null);
    setUsernameRejected(false);
    focusAfterRef.current = "form";
    setIsEditing(true);
  };
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    profileImage: "",
  });

  // Load user data
  useEffect(() => {
    if (signedIn) {
      setFormData({
        username: handle || fullName || "",
        email: email || "",
        profileImage: imageUrl || "",
      });
    }
  }, [signedIn, handle, fullName, email, imageUrl]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setUsernameRejected(false);
    try {
      if (!handle) throw new Error("Your profile isn't ready yet; try again in a moment");
      const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        if ([400, 409, 422].includes(response.status)) setUsernameRejected(true);
        const errorMessage = data.error?.detail || data.error?.title || "Failed to update profile";
        throw new Error(errorMessage);
      }

      if (data.success) {
        toast.success("Profile updated successfully");
        focusAfterRef.current = "edit";
        setIsEditing(false);
        // A renamed handle is the one the next save goes to.
        if (!user?.username) setSessionHandle(formData.username);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to update profile";
      setSaveError(errorMessage);
      toast.error(errorMessage);
      console.error("Error updating profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (user) {
      setFormData({
        username: handle || user.fullName || "",
        email: user.email || "",
        profileImage: user.imageUrl || "",
      });
    }
    setSaveError(null);
    setUsernameRejected(false);
    focusAfterRef.current = "edit";
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle role="heading" aria-level={2} className="cd-subheading flex items-center gap-2">
            <User className="h-5 w-5" aria-hidden="true" style={{ color: "var(--cd-action)" }} />
            My Profile
          </CardTitle>
          {!isEditing && (
            <Button
              ref={editButtonRef}
              variant="outline"
              size="sm"
              onClick={startEditing}
            >
              <Edit className="h-4 w-4 mr-2" aria-hidden="true" />
              Edit Profile
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center gap-3">
            <Avatar className="h-20 w-20 md:h-24 md:w-24">
              {formData.profileImage ? (
                <AvatarImage src={formData.profileImage} alt="" />
              ) : null}
              {/* Also shown when the picture can't load (UI08.3). */}
              <AvatarFallback>
                <User className="h-10 w-10 md:h-12 md:w-12" aria-hidden="true" />
              </AvatarFallback>
            </Avatar>
            {isEditing && (
              <div className="w-full max-w-xs space-y-2">
                <label htmlFor="profile-image-url" className="cd-small font-medium">
                  Profile image URL
                </label>
                <Input
                  id="profile-image-url"
                  type="url"
                  inputMode="url"
                  placeholder="Profile Image URL"
                  value={formData.profileImage}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      profileImage: e.target.value,
                    }))
                  }
                />
              </div>
            )}
          </div>

          {/* Profile Info Section */}
          <div className="flex-1 min-w-0 space-y-4">
            {isEditing ? (
              <>
                <div className="space-y-2">
                  <label htmlFor="profile-username" className="cd-small font-medium">Username</label>
                  <Input
                    ref={usernameRef}
                    id="profile-username"
                    placeholder="Username"
                    autoComplete="username"
                    value={formData.username}
                    aria-invalid={usernameRejected ? true : undefined}
                    aria-describedby={saveError ? "profile-save-error" : undefined}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        username: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="profile-email" className="cd-small font-medium">Email</label>
                  <Input
                    id="profile-email"
                    placeholder="Email"
                    value={formData.email}
                    aria-describedby="profile-email-help"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    disabled
                  />
                  <p id="profile-email-help" className="cd-caption">
                    Email is managed by your authentication provider
                  </p>
                </div>
                {saveError && (
                  <p id="profile-save-error" role="alert" className="cd-error-text cd-wrap">
                    Your profile wasn&apos;t saved: {saveError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                        Save Changes
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    <X className="h-4 w-4 mr-2" aria-hidden="true" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <dl className="space-y-4">
                <div>
                  <dt className="cd-small font-medium cd-muted">
                    Username
                  </dt>
                  <dd className="text-lg font-semibold cd-wrap">{formData.username}</dd>
                </div>
                <div>
                  <dt className="cd-small font-medium cd-muted">
                    Email
                  </dt>
                  <dd className="cd-small cd-wrap">{formData.email}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardContent() {
  const {
    data: dashboardData,
    loading,
    error,
    refresh,
  } = useDashboardStats();

  // First load: placeholders. A failed first load: the error with Try
  // again. A failed refresh keeps the last data, with a note above it.
  if (!dashboardData) {
    if (error && !loading)
      return (
        <div className="cd-stack">
          <DiscoveryHeader title="Personal Analytics Dashboard" />
          <DashboardError refresh={refresh} />
        </div>
      );
    return <DashboardSkeleton />;
  }

  const { stats } = dashboardData;

  return (
    <>
      {error && !loading && <DashboardError refresh={refresh} stale />}
      <DashboardMain stats={stats} refresh={refresh} />
    </>
  );
}

// Dashboard main content with stats
function DashboardMain({
  stats,
  refresh,
}: {
  stats: UserDashboardStats;
  refresh: () => Promise<void>;
}) {
  const { user } = useDisplayUser();
  const [refreshingTagSubmissions, setRefreshingTagSubmissions] = React.useState(false);
  const [refreshingMyProjects, setRefreshingMyProjects] = React.useState(false);
  const [refreshingFavorites, setRefreshingFavorites] = React.useState(false);
  const [refreshingAppreciation, setRefreshingAppreciation] = React.useState(false);
  const [refreshingActivity, setRefreshingActivity] = React.useState(false);
  const [refreshingPopularTags, setRefreshingPopularTags] = React.useState(false);
  const [refreshingStats, setRefreshingStats] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshTagSubmissions = React.useCallback(async () => {
    setRefreshingTagSubmissions(true);
    try {
      await refresh();
      toast.success('Tag submissions refreshed');
    } catch (error) {
      toast.error('Failed to refresh tag submissions');
      console.error('Error refreshing tag submissions:', error);
    } finally {
      setRefreshingTagSubmissions(false);
    }
  }, [refresh]);

  const refreshMyProjects = React.useCallback(async () => {
    setRefreshingMyProjects(true);
    try {
      await refresh();
      toast.success('My projects refreshed');
    } catch (error) {
      toast.error('Failed to refresh projects');
      console.error('Error refreshing projects:', error);
    } finally {
      setRefreshingMyProjects(false);
    }
  }, [refresh]);

  const refreshFavorites = React.useCallback(async () => {
    setRefreshingFavorites(true);
    try {
      await refresh();
      toast.success('Favorites refreshed');
    } catch (error) {
      toast.error('Failed to refresh favorites');
      console.error('Error refreshing favorites:', error);
    } finally {
      setRefreshingFavorites(false);
    }
  }, [refresh]);

  const refreshAppreciation = React.useCallback(async () => {
    setRefreshingAppreciation(true);
    try {
      await refresh();
      toast.success('Recent appreciation refreshed');
    } catch (error) {
      toast.error('Failed to refresh appreciation');
      console.error('Error refreshing appreciation:', error);
    } finally {
      setRefreshingAppreciation(false);
    }
  }, [refresh]);

  const refreshActivity = React.useCallback(async () => {
    setRefreshingActivity(true);
    try {
      await refresh();
      toast.success('Recent activity refreshed');
    } catch (error) {
      toast.error('Failed to refresh activity');
      console.error('Error refreshing activity:', error);
    } finally {
      setRefreshingActivity(false);
    }
  }, [refresh]);

  const refreshPopularTags = React.useCallback(async () => {
    setRefreshingPopularTags(true);
    try {
      await refresh();
      toast.success('Popular tags refreshed');
    } catch (error) {
      toast.error('Failed to refresh popular tags');
      console.error('Error refreshing popular tags:', error);
    } finally {
      setRefreshingPopularTags(false);
    }
  }, [refresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshingStats(true);
    setRefreshingMyProjects(true);
    setRefreshingFavorites(true);
    setRefreshingAppreciation(true);
    setRefreshingActivity(true);
    setRefreshingPopularTags(true);
    setRefreshingTagSubmissions(true);
    try {
      await refresh();
      toast.success('Dashboard refreshed');
    } catch (error) {
      toast.error('Failed to refresh dashboard');
      console.error('Error refreshing dashboard:', error);
    } finally {
      setIsRefreshing(false);
      setRefreshingStats(false);
      setRefreshingMyProjects(false);
      setRefreshingFavorites(false);
      setRefreshingAppreciation(false);
      setRefreshingActivity(false);
      setRefreshingPopularTags(false);
      setRefreshingTagSubmissions(false);
    }
  };

  // PageBanner's name rule: an email shows only the part before the @.
  const rawName = user?.fullName || user?.firstName || user?.email || "User";
  const displayName = rawName.includes("@") ? rawName.split("@")[0] : rawName;

  return (
    <div className="cd-stack">
      {/* Dashboard header: one h1, the refresh action beside it */}
      <DiscoveryHeader
        eyebrow={`${displayName}'s`}
        title="Personal Analytics Dashboard"
        lead={
          stats.totalProjects > 0 ? (
            <>
              📂 You have shared{" "}
              <a
                href="#my-projects-card"
                className="cd-link font-semibold"
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById("my-projects-card");
                  if (el) {
                    el.scrollIntoView({ behavior: scrollMotion(), block: "start" });
                    const card = el.querySelector(".stat-card");
                    if (card) {
                      setTimeout(() => card?.classList.add("highlight-flash"), 500);
                      setTimeout(() => card?.classList.remove("highlight-flash"), 3000);
                    }
                  }
                }}
              >
                {stats.totalProjects}
              </a>{" "}
              project{stats.totalProjects > 1 ? "s" : ""} with the community
            </>
          ) : (
            "Welcome back! Your creative journey starts here. Share your first project and inspire the community! This dashboard is only visible to you."
          )
        }
        aside={
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh dashboard data"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        }
      />

      {/* Profile Editor Card */}
      <ProfileEditorCard />

      {/* Create First Project Prompt - Only show when user has 0 projects */}
      {stats.totalProjects === 0 && <CreateFirstProjectPrompt />}

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div id="my-projects-card" className="scroll-mt-20">
          {refreshingStats ? (
            <Card className="min-h-40 lg:h-[250px]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center flex-1">
                <Skeleton className="h-12 w-16 mb-2" />
                <Skeleton className="h-3 w-32 mb-3" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ) : (
            <MyProjectsCard 
              totalProjects={stats.totalProjects} 
              activeThisWeek={stats.projectStats.activeThisWeek}
            />
          )}
        </div>
        <div id="favorites-received-card" className="scroll-mt-20">
          {refreshingStats ? (
            <Card className="min-h-40 lg:h-[250px]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent className="flex flex-row gap-3 flex-1">
                <div className="flex flex-col items-center justify-center w-1/3">
                  <Skeleton className="h-10 w-12 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <div className="flex-1">
                  <div className="space-y-1">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <FavoritesReceivedCard
              totalFavorites={stats.totalFavorites}
              projectsWithFavorites={stats.projectsWithFavorites}
            />
          )}
        </div>
        <div id="favorites-given-card" className="scroll-mt-20">
          {refreshingStats ? (
            <Card className="min-h-40 lg:h-[250px]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center flex-1">
                <Skeleton className="h-12 w-16 mb-2" />
                <Skeleton className="h-3 w-40 mb-3" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ) : (
            <FavoritesGivenCard totalFavoritesGiven={stats.totalFavoritesGiven} />
          )}
        </div>
        <div id="my-tags-card" className="scroll-mt-20">
          {refreshingStats ? (
            <Card className="min-h-40 lg:h-[250px]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent className="flex flex-row gap-4 flex-1">
                <div className="flex flex-col items-center justify-center w-1/2">
                  <Skeleton className="h-12 w-12 mb-2" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    {[...Array(8)].map((_, i) => (
                      <Skeleton key={i} className="h-5 w-16" />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <TagsCard
              title="My Tags"
              value={(stats.allTags?.length || 0).toString()}
              icon={<TagIcon className="h-4 w-4 text-primary" aria-hidden="true" />}
              tags={stats.allTags || []}
            />
          )}
        </div>
      </div>

      {/* Main Content - Three Columns */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {/* Left Column - Recent Appreciation */}
        <Card className="md:col-span-2 xl:col-span-1 flex flex-col max-h-[36rem] lg:max-h-none lg:h-[600px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 flex-shrink-0">
            <CardTitle role="heading" aria-level={2} className="cd-small font-semibold">
              Recent Appreciation
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Refresh recent appreciation"
                onClick={refreshAppreciation}
                disabled={refreshingAppreciation}
              >
                <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${refreshingAppreciation ? 'animate-spin' : ''}`} />
              </Button>
              <Heart className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardHeader className="flex-shrink-0 pt-0">
            <CardDescription className="cd-caption">
              Favorites received in the last 90 days
            </CardDescription>
          </CardHeader>
          <CardContent tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
            {refreshingAppreciation ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : stats.recentAppreciation && stats.recentAppreciation.length > 0 ? (
              <div className="space-y-2">
                {stats.recentAppreciation
                  .slice(0, 8)
                  .map((appreciation, index) => (
                    <RecentAppreciationItem key={index} {...appreciation} />
                  ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Heart className="h-12 w-12 mx-auto cd-muted mb-2" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  No favorites received in the last 90 days. Don&apos;t worry someone will like your
                  masterpiece soon!
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle Column - Recent Activity */}
        <Card className="md:col-span-1 xl:col-span-1 flex flex-col max-h-[36rem] lg:max-h-none lg:h-[600px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 flex-shrink-0">
            <CardTitle role="heading" aria-level={2} className="cd-small font-semibold">
              Recent Activity
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Refresh recent activity"
                onClick={refreshActivity}
                disabled={refreshingActivity}
              >
                <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${refreshingActivity ? 'animate-spin' : ''}`} />
              </Button>
              <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardHeader className="flex-shrink-0 pt-0">
            <CardDescription className="cd-caption">
              Projects created or updated in the last 60 days
            </CardDescription>
          </CardHeader>
          <CardContent tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
            {refreshingActivity ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="p-2 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : stats.recentActivity.length > 0 ? (
              <div className="space-y-2">
                {stats.recentActivity.map((activity) => (
                  <ActivityItem
                    key={activity.id}
                    slug={activity.slug}
                    title={activity.title}
                    description={`Project ${activity.action}`}
                    timestamp={activity.timestamp}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No activity in the last 60 days
              </p>
            )}
          </CardContent>
        </Card>

        {/* Right Column - Popular Tags */}
        <Card className="md:col-span-1 xl:col-span-1 flex flex-col max-h-[36rem] lg:max-h-none lg:h-[600px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 flex-shrink-0">
            <CardTitle role="heading" aria-level={2} className="cd-small font-semibold">
              My Popular Tags
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Refresh popular tags"
                onClick={refreshPopularTags}
                disabled={refreshingPopularTags}
              >
                <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${refreshingPopularTags ? 'animate-spin' : ''}`} />
              </Button>
              <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardHeader className="flex-shrink-0 pt-0">
            <CardDescription className="cd-caption">
              Most frequently used tags (number shows project count)
            </CardDescription>
          </CardHeader>
          <CardContent tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
            {refreshingPopularTags ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : stats.topTags.length > 0 ? (
              <>
                <div className="space-y-2">
                  {/* Show tags with 2+ projects (up to 8 total) */}
                  {stats.topTags
                    .filter((tag) => tag.count > 1)
                    .slice(0, 8)
                    .map((tag) => (
                      <Accordion key={tag.name} type="single" collapsible>
                        <AccordionItem
                          value={tag.name}
                          className="border rounded-lg"
                        >
                          <AccordionTrigger className="px-3 py-2 hover:no-underline">
                            <div className="flex items-center justify-between w-full pr-2">
                              <span className="text-sm font-medium truncate">
                                <span className="text-foreground">#</span>{tag.name}
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">
                                  {tag.count}{" "}
                                  {tag.count === 1 ? "project" : "projects"}
                                </span>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <div className="space-y-1">
                              {tag.projects && tag.projects.length > 0 ? (
                                tag.projects.map((project) => (
                                  <PopularTagProjectItem
                                    key={project.id}
                                    project={project}
                                  />
                                ))
                              ) : (
                                <p className="text-xs text-muted-foreground text-center py-2">
                                  No projects found
                                </p>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    ))}
                </div>

                {/* Show tags with only 1 project in a collapsible section */}
                {stats.topTags.filter((tag) => tag.count === 1).length > 0 && (
                  <Accordion type="single" collapsible className="mt-3">
                    <AccordionItem
                      value="single-use-tags"
                      className="border rounded-lg"
                    >
                      <AccordionTrigger className="px-3 py-2 hover:no-underline">
                        <div className="flex items-center justify-between w-full pr-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Tags used in a single project (
                            {
                              stats.topTags.filter((tag) => tag.count === 1)
                                .length
                            }
                            )
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-3 pb-2">
                        <div className="space-y-1">
                          {stats.topTags
                            .filter((tag) => tag.count === 1)
                            .map((tag) => (
                              <SingleUseTagItem key={tag.name} tag={tag} />
                            ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No tags yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* My Projects Section */}
      <Card id="my-projects" className="flex flex-col max-h-[44rem] sm:max-h-[620px] 3xl:max-h-[1200px] scroll-mt-20">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 flex-shrink-0">
          <div className="flex-1">
            <CardTitle role="heading" aria-level={2}>My Recent Projects ({Math.min(stats.myProjects.length, 8)})</CardTitle>
            <CardDescription className="text-xs mt-1">
              Your most recently updated projects
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Refresh my recent projects"
              onClick={refreshMyProjects}
              disabled={refreshingMyProjects}
            >
              <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${refreshingMyProjects ? 'animate-spin' : ''}`} />
            </Button>
            <Code className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
          {refreshingMyProjects ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="h-[220px] 3xl:h-[460px]">
                  <CardHeader className="pb-3 pt-12">
                    <Skeleton className="h-5 w-3/4 mb-3" />
                    <div className="flex gap-1.5">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : stats.myProjects.length > 0 ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
              {stats.myProjects.slice(0, 8).map((project) => (
                <ProjectCard key={project.id} {...project} />
              ))}
            </div>
          ) : (
            <div className="cd-empty">
              <Code className="h-12 w-12 cd-muted" aria-hidden="true" />
              <p className="cd-muted">
                You haven&apos;t created any projects yet
              </p>
              <Button asChild>
                <Link href="/projects/new">Create Your First Project</Link>
              </Button>
            </div>
          )}
        </CardContent>
        {stats.myProjects.length > 8 && <ViewAllProjectsButton />}
      </Card>

      {/* Projects I've Favorited */}
      {stats.myFavorites.length > 0 && (
        <Card id="favorites-given" className="flex flex-col max-h-[44rem] sm:max-h-[710px] 3xl:max-h-[1200px] scroll-mt-20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 flex-shrink-0">
            <div className="flex-1">
              <CardTitle role="heading" aria-level={2}>Projects I&apos;ve Favorited ❤️ ({Math.min(stats.myFavorites.length, 8)})</CardTitle>
              <CardDescription className="text-xs mt-1">
                Projects you most recently favorited from the community
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Refresh projects I've favorited"
                onClick={refreshFavorites}
                disabled={refreshingFavorites}
              >
                <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${refreshingFavorites ? 'animate-spin' : ''}`} />
              </Button>
              <Heart className="h-4 w-4 text-red-500 fill-red-500" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent tabIndex={0} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
            {refreshingFavorites ? (
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
                {[...Array(8)].map((_, i) => (
                  <Card key={i} className="h-[220px] 3xl:h-[460px]">
                    <CardHeader className="pb-3 pt-12">
                      <Skeleton className="h-5 w-3/4 mb-3" />
                      <Skeleton className="h-3 w-1/2" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
                {stats.myFavorites.slice(0, 8).map((favorite) => (
                <FavoriteCard key={favorite.id} {...favorite} />
              ))}
              </div>
            )}
          </CardContent>
          {stats.myFavorites.length > 8 && <ViewAllFavoritesButton />}
        </Card>
      )}

      {/* My Tag Submissions */}
      <Card id="tag-submissions" className="flex flex-col scroll-mt-20">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3 flex-shrink-0">
          <div className="flex-1 min-w-0">
          <CardTitle role="heading" aria-level={2} className="text-lg">My Tag Submissions</CardTitle>
          <CardDescription className="cd-small">
            {stats.myTagSubmissions.length > 0 ? (
              <>
                {stats.myTagSubmissions.length} tag
                {stats.myTagSubmissions.length > 1 ? "s" : ""} submitted
              </>
            ) : (
              "No tag submissions yet"
            )}
          </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshTagSubmissions}
              disabled={refreshingTagSubmissions}
              aria-label="Refresh tag submissions"
            >
              <RefreshCcw aria-hidden="true" className={`h-4 w-4 mr-1.5 ${refreshingTagSubmissions ? 'animate-spin' : ''}`} />
              <span>{refreshingTagSubmissions ? 'Refreshing...' : 'Refresh'}</span>
            </Button>
            <TagIcon className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Tag Contribution Info Accordion */}
          <Accordion type="single" collapsible className="mb-6">
            <AccordionItem
              value="about-submissions"
              className="border rounded-xl"
              style={{ borderColor: "var(--cd-border-subtle)", background: "var(--cd-raised)" }}
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" aria-hidden="true" style={{ color: "var(--cd-action)" }} />
                  <span className="cd-small font-semibold">
                    About Tag Submissions
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3 pt-2">
                  <p className="cd-small cd-reading">
                    <span className="font-semibold">✨ Share Your Tags</span>{" "}
                    When editing your project, submit tags you think should be in the system if not already there for you. Once{" "}
                    <span className="font-medium">approved</span>, you can use them in your projects and others can add them to theirs too!
                  </p>
                  <p className="cd-small cd-reading">
                    <span className="font-semibold">🎯 Why Tags Matter</span>{" "}
                    Tags add specific tech details beyond categories like frameworks, languages, or concepts helping developers find exactly what they need and your projects more efficiently and deliberately.
                  </p>
                  <p className="cd-small cd-reading">
                    <span className="font-semibold">💡 Review Process</span>{" "}
                    Tags get reviewed for quality as they are available for everyone in the community.{" "}
                    <span className="font-medium">Rejections?</span>{" "}
                    Don&apos;t sweat it! They&apos;re not about you, we are just keeping tags clean, consistent, and useful for everyone.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {refreshingTagSubmissions ? (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {[...Array(3)].map((_, colIdx) => (
                <div key={colIdx}>
                  <div className="flex items-center gap-2 mb-3">
                    <Skeleton className="h-1 w-1 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2 mb-2">
                          <Skeleton className="h-5 w-20" />
                          <Skeleton className="h-5 w-24" />
                        </div>
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : stats.myTagSubmissions.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Pending Submissions Column */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: "var(--cd-warning)" }} />
                  <h3 className="cd-small font-semibold cd-muted uppercase tracking-wide">
                    Pending (
                    {
                      stats.myTagSubmissions.filter(
                        (s) => s.status === "pending"
                      ).length
                    }
                    )
                  </h3>
                </div>
                <div tabIndex={0} className="space-y-2 max-h-[500px] overflow-y-auto overscroll-contain pr-2">
                  {stats.myTagSubmissions.filter((s) => s.status === "pending")
                    .length > 0 ? (
                    stats.myTagSubmissions
                      .filter((s) => s.status === "pending")
                      .map((submission, index) => (
                        <TagSubmissionCard key={index} {...submission} />
                      ))
                  ) : (
                    <p className="cd-small cd-muted text-center py-4">
                      No pending submissions
                    </p>
                  )}
                </div>
              </div>

              {/* Approved Submissions Column */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: "var(--cd-success)" }} />
                  <h3 className="cd-small font-semibold cd-muted uppercase tracking-wide">
                    Approved (
                    {
                      stats.myTagSubmissions.filter(
                        (s) => s.status === "approved"
                      ).length
                    }
                    )
                  </h3>
                </div>
                <div tabIndex={0} className="space-y-2 max-h-[500px] overflow-y-auto overscroll-contain pr-2">
                  {stats.myTagSubmissions.filter((s) => s.status === "approved")
                    .length > 0 ? (
                    stats.myTagSubmissions
                      .filter((s) => s.status === "approved")
                      .map((submission, index) => (
                        <TagSubmissionCard key={index} {...submission} />
                      ))
                  ) : (
                    <p className="cd-small cd-muted text-center py-4">
                      No approved submissions
                    </p>
                  )}
                </div>
              </div>

              {/* Rejected Submissions Column */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: "var(--cd-danger)" }} />
                  <h3 className="cd-small font-semibold cd-muted uppercase tracking-wide">
                    Rejected (
                    {
                      stats.myTagSubmissions.filter(
                        (s) => s.status === "rejected"
                      ).length
                    }
                    )
                  </h3>
                </div>
                {/* Rejected column help message */}
                {stats.myTagSubmissions.filter((s) => s.status === "rejected").length > 0 && (
                  <Accordion type="single" collapsible className="mb-3">
                    <AccordionItem
                      value="rejected-help"
                      className="border rounded-xl"
                      style={{ borderColor: "var(--cd-border-subtle)", background: "var(--cd-raised)" }}
                    >
                      <AccordionTrigger className="px-3 py-2 hover:no-underline">
                        <span className="cd-small font-semibold">
                          💡 Got a Rejection? Here&apos;s What to Do
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-3 pb-3">
                        <p className="cd-small cd-muted">
                          <span className="font-semibold" style={{ color: "var(--cd-text)" }}>Think this was a mistake?</span> You can resubmit the tag with a better explanation of why it&apos;s useful for the community. Focus on how it helps categorize projects, describes specific technologies, or aids in discovery for all users.
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
                <div tabIndex={0} className="space-y-2 max-h-[500px] overflow-y-auto overscroll-contain pr-2">
                  {stats.myTagSubmissions.filter((s) => s.status === "rejected")
                    .length > 0 ? (
                    stats.myTagSubmissions
                      .filter((s) => s.status === "rejected")
                      .map((submission, index) => (
                        <TagSubmissionCard key={index} {...submission} />
                      ))
                  ) : (
                    <p className="cd-small cd-muted text-center py-4">
                      No rejected submissions
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="cd-empty">
              <TagIcon className="h-12 w-12 cd-muted" aria-hidden="true" />
              <h3 className="cd-subheading">No Tag Submissions Yet</h3>
              <p className="cd-small cd-muted max-w-md">
                When you edit a project, you can submit new tags that aren&apos;t in the system yet. 
                Once approved, they&apos;ll be available for everyone to use!
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}



export default function DashboardPage() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page">
          <ErrorBoundary>
            <DashboardContent />
          </ErrorBoundary>
        </div>
      </div>
    </AppShell>
  );
}
