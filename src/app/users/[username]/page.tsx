"use client";

// UI06.3: a member's profile on the UI03 foundations and the shared AppShell.
// Same data and links as before. A missing profile and a failed request are
// told apart now: only a 404 says "Profile Not Found" (UI02 found a server
// failure reading as a missing person).
import "@/styles/foundations.css";
import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { User, Heart, FolderKanban, Calendar } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicProfileRow } from "@/backend/profiles/public-profile";
import { useRouter } from "next/navigation";

interface PageProps {
  params: Promise<{ username: string }>;
}

class ProfileRequestError extends Error {
  constructor(message: string, readonly notFound: boolean) {
    super(message);
  }
}

function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export default function UserProfilePage({ params }: PageProps) {
  const resolvedParams = params instanceof Promise ? use(params) : params;
  const username = decodeURIComponent(resolvedParams.username);
  const [profileData, setProfileData] = useState<PublicProfileRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [stats, setStats] = useState({
    totalLikes: 0,
    totalTags: 0,
    totalProjects: 0,
    activeProjects: 0,
    graveyardProjects: 0,
    communityProjects: 0,
    projectsFavorited: 0,
    projectsReceivedFavorites: 0,
    mostLikedProject: { title: "", favorites: 0 },
    joinedDate: null as Date | null,
  });
  const [isNavigating, setIsNavigating] = useState(false);
  const router = useRouter();

  const handleProjectsClick = (e: React.MouseEvent) => {
    // Modified clicks open a new tab as links do; a plain click shows the spinner.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    setIsNavigating(true);
  };

  const loadProfile = useCallback(() => {
    if (!username) return;
    setIsLoading(true);
    setError(null);
    // Fetch profile data with stats in a single request. D04a: by username;
    // the page no longer gets the owner's provider subject to call by-id.
    fetch(`/api/profiles/lookup/${encodeURIComponent(username)}?includeStats=true`)
      .then(async (response) => {
        if (!response.ok) {
          throw new ProfileRequestError("Failed to fetch profile", response.status === 404);
        }
        const responseData = await response.json();

        // Check for API error responses (RFC 7807 format)
        if (responseData.success === false || responseData.error) {
          throw new ProfileRequestError(responseData.error?.detail || responseData.detail || "Profile not found", true);
        }

        // The success() helper wraps data in { success: true, data: {...} }
        const data = responseData.data || responseData;

        // Check if this is a redirect response (old username was used)
        if (data.redirect && data.currentUsername) {
          // Redirect to the current username URL
          router.replace(`/users/${encodeURIComponent(data.currentUsername)}`);
          return null; // Stop the chain
        }

        // Check if profile exists in response
        if (!data.profile) {
          throw new ProfileRequestError("Profile data not found in response", true);
        }

        return responseData;
      })
      .then((responseData) => {
        if (!responseData) return; // Redirect happened

        // Handle both old format (direct) and new format (wrapped in data)
        const data = responseData.data || responseData;

        if (data.profile) {
          setProfileData(data.profile);
        }
        if (data.stats) {
          setStats(data.stats);
        }
      })
      .catch((err) => {
        console.error("Error fetching profile:", err);
        setError({
          message: err.message || "Failed to load profile",
          notFound: err instanceof ProfileRequestError ? err.notFound : false,
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [username, router]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  let body: React.ReactNode;
  if (error) {
    body = error.notFound ? (
      <div className="cd-surface cd-stack-tight cd-reading">
        <h1 className="cd-heading flex items-center gap-2">
          <User className="h-5 w-5" aria-hidden="true" />
          Profile Not Found
        </h1>
        <p className="cd-muted cd-wrap">
          The user &quot;{username}&quot; could not be found. They may have changed their username or the profile doesn&apos;t exist.
        </p>
        <div className="pt-2">
          <Button variant="outline" asChild>
            <Link href="/users">Browse Users</Link>
          </Button>
        </div>
      </div>
    ) : (
      <div role="alert" className="cd-surface cd-stack-tight cd-reading" style={{ borderColor: "var(--cd-danger)" }}>
        <h1 className="cd-heading">This profile didn&apos;t load</h1>
        <p className="cd-muted cd-wrap">Something went wrong on our side while loading &quot;{username}&quot;. Try again in a moment.</p>
        <div className="cd-cluster pt-2">
          <Button onClick={loadProfile}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/users">Browse Users</Link>
          </Button>
        </div>
      </div>
    );
  } else if (isLoading || !profileData) {
    body = (
      <>
        <p role="status" className="sr-only">
          Loading profile
        </p>
        <div aria-hidden="true" className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="cd-surface flex flex-col items-center gap-4">
            <Skeleton className="h-24 w-24 rounded-full" />
            <Skeleton className="h-7 w-40" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-2">
            {[0, 1].map((i) => (
              <div key={i} className="cd-surface cd-stack-tight">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-9 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  } else {
    const days = stats.joinedDate
      ? Math.floor((Date.now() - new Date(stats.joinedDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    body = (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Profile */}
        <section aria-label="Profile" className="cd-surface flex flex-col items-center gap-4 text-center">
          <Avatar className="h-24 w-24 flex-shrink-0">
            {profileData.profile_image_url ? (
              <AvatarImage src={profileData.profile_image_url} alt="" />
            ) : null}
            <AvatarFallback>
              <User className="h-12 w-12" aria-hidden="true" />
            </AvatarFallback>
          </Avatar>
          <div className="cd-stack-tight w-full items-center">
            <p className="cd-small cd-muted">Profile</p>
            <h1 className="cd-heading cd-wrap">{profileData.username || "Loading..."}</h1>
          </div>
        </section>

        {/* Stats */}
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 md:col-span-2" aria-label="Stats">
          {/* Public Stats - Visible to everyone */}
          <li className="cd-surface cd-stack-tight">
            <h2 className="cd-small flex items-center gap-2 font-medium">
              <FolderKanban className="h-5 w-5" style={{ color: "var(--cd-action)" }} aria-hidden="true" />
              Active Projects
            </h2>
            <p className="cd-title cd-number">{stats.activeProjects}</p>
            <p className="cd-caption">Public projects</p>
            <Button asChild className="mt-2 w-full">
              <Link href={`/projects/users/${encodeURIComponent(username)}`} onClick={handleProjectsClick}>
                {isNavigating ? (
                  <>
                    <Spinner />
                    Loading...
                  </>
                ) : (
                  "View Projects →"
                )}
              </Link>
            </Button>
          </li>

          <li className="cd-surface cd-stack-tight">
            <h2 className="cd-small flex items-center gap-2 font-medium">
              <Heart className="h-5 w-5" style={{ color: "var(--cd-action)" }} aria-hidden="true" />
              Favorites Given
            </h2>
            <p className="cd-title cd-number">{stats.projectsFavorited}</p>
            <p className="cd-caption">Projects favorited</p>
          </li>

          {stats.joinedDate && (
            <li className="cd-surface cd-stack-tight">
              <h2 className="cd-small flex items-center gap-2 font-medium">
                <Calendar className="h-5 w-5" style={{ color: "var(--cd-action)" }} aria-hidden="true" />
                Member Since
              </h2>
              <p className="cd-subheading">
                {new Date(stats.joinedDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </p>
              <p className="cd-caption">{days} days</p>
            </li>
          )}
        </ul>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">{body}</div>
      </div>
    </AppShell>
  );
}
