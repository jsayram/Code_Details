"use client";

// UI07: on AppShell and the foundations. Signed out, the sidebar shows its
// public entries and the page still asks for a sign-in; the projects list,
// the old-username redirect and the sign-in toast are unchanged.
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";
import { SignedIn, SignedOut } from "@/components/auth/AuthGate";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { ProjectList } from "@/components/Projects";
import { useState, use } from "react";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import type { PublicProfileRow } from "@/backend/profiles/public-profile";
import { useEffect } from "react";
import { UserProfileLoadingState } from "@/components/LoadingState/UserProfileLoadingState";
import { capitalizeNames } from "@/utils/stringUtils";
import { toast } from "sonner";
import Image from "next/image";
import { TerminalWindowSection } from "@/components/layout/TerminalWindowSection";
import { useRouter } from "next/navigation";
import { USER_PROJECTS_DEFAULT_LIMIT } from "@/constants/project-limits";

interface PageProps {
  params: Promise<{ username: string }>;
}

export default function UserProjectsPage({ params }: PageProps) {
  const resolvedParams = params instanceof Promise ? use(params) : params;
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();
  // The app's login decides; the toast waits for the session to load.
  const signedIn = !!viewer.userId;
  const waitingForSession = viewer.isLoading;
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);
  const [profileData, setProfileData] = useState<PublicProfileRow | null>(null);
  const router = useRouter();

  // derive the decoded username from route params immediately
  const decodedUsername = resolvedParams.username
    ? decodeURIComponent(resolvedParams.username)
    : "";

  // Derive a trimmed username (everything before "@") if available
  const trimmedUsername = profileData?.username
    ? profileData.username.split("@")[0]
    : decodedUsername;

  // fetch profile data when decodedUsername changes
  useEffect(() => {
    if (!decodedUsername) return;

    const fetchProfile = async () => {
      try {
        if (waitingForSession) return;
        if (!signedIn) {
          toast.dismiss();
          toast.info(
            <div className="relative flex flex-row items-center gap-2">
              <Image
                src="/images/mascot.png"
                alt="Code Minion"
                width={50}
                height={50}
                className="relative rounded-md"
              />
              <p>You have to be logged in to view user profiles silly goose</p>
            </div>
          );
          return;
        }
        const response = await fetch(
          `/api/profiles/${encodeURIComponent(decodedUsername)}`
        );

        // Check if response is OK and content-type is JSON
        const contentType = response.headers.get("content-type");
        if (!response.ok || !contentType?.includes("application/json")) {
          console.error("Invalid response:", response.status);
          return;
        }

        // Safely parse JSON
        const result = await response.json();
        
        // Check if this is a redirect response (old username was used)
        if (result.success && result.data?.redirect && result.data?.currentUsername) {
          router.replace(`/projects/users/${encodeURIComponent(result.data.currentUsername)}`);
          return;
        }
        
        if (result.success && result.data?.profile) {
          setProfileData(result.data.profile);
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
      }
    };

    fetchProfile();
  }, [decodedUsername, signedIn, waitingForSession, router]);

  // Only consider loading if we're waiting for auth-related data AND we don't have profile data yet
  const isLoading = viewer.isLoading && !profileData;

  const displayName = profileData?.full_name
    ? capitalizeNames(profileData.full_name)
    : trimmedUsername || decodedUsername || "Anonymous User";

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          {isLoading ? (
            <UserProfileLoadingState />
          ) : (
            <ProjectsProvider
              userId={viewer.userId}
              isLoading={isLoading}
              initialFilters={{
                username: decodedUsername,
                showAll: false,
                page: currentPage,
                limit: USER_PROJECTS_DEFAULT_LIMIT,
              }}
            >
              <SignedIn>
                <div className="cd-stack">
                  <DiscoveryHeader
                    eyebrow={`${displayName.split(" ")[0]}'s projects`}
                    title="Projects Showcase"
                    lead={profileData?.full_name ? `Browse all projects by ${trimmedUsername}` : "Browse user's projects"}
                  />
                  <ProjectList currentPage={currentPage} onPageChange={setCurrentPage} />
                </div>
              </SignedIn>
              <SignedOut>
                {/* Member profiles stay behind sign-in, as before. */}
                <div className="cd-surface cd-empty mx-auto w-full max-w-2xl">
                  <h1 className="cd-heading">Authentication Required To View User Profiles</h1>
                  <TerminalWindowSection
                    unauthenticatedMessage="Please sign in to view user profiles and their projects"
                    width="w-full lg:w-[500px] xl:w-[500px]"
                    height="h-[200px] lg:h-[200px] xl:h-[200px]"
                    showDatetime={false}
                  />
                  <p className="cd-muted">You need to be signed in to view user profiles and their projects.</p>
                  <Image src="/images/mascot.png" alt="" width={124} height={160} sizes="124px" />
                </div>
              </SignedOut>
            </ProjectsProvider>
          )}
        </div>
      </div>
    </AppShell>
  );
}
