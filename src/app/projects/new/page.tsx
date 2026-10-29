"use client";

import React from "react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ProjectsProvider } from "@/providers/projects-provider";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import { ProjectCreateComponent } from "@/components/Projects/ProjectComponents/ProjectCreateComponent";
import { useUser } from "@clerk/nextjs";
import { useSupabaseToken } from "@/hooks/use-SupabaseClerkJWTToken";
import { redirect } from "next/navigation";
import ProtectedPage from "@/app/auth/ProtectedPage";
import { PROTECTED_PAGES_TIERS } from "@/app/auth/protectedPageConstants";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { SelectUserWithProject } from "@/db/schema/projects";
import { useAuthBackend } from "@/backend/auth/context";
import { useViewerId } from "@/components/auth/AuthGate";

export default function CreateProjectPage() {
  const { user, isLoaded: userLoaded } = useUser();
  const { token, loading: tokenLoading } = useSupabaseToken();
  // D03: under the development Better Auth switch the page follows that
  // session; ProtectedPage below sends a signed-out visitor to sign in, and
  // the save goes to Convex, which takes the creator from the session.
  const clerkMode = useAuthBackend() === "clerk";
  const viewerId = useViewerId();
  const ownerId = clerkMode ? user?.id || "" : viewerId ?? "";

  // If user is not logged in, redirect to sign in
  if (clerkMode && userLoaded && !user) {
    redirect("/sign-in");
  }

  // If still loading, show loading state
  if (clerkMode && (!userLoaded || tokenLoading)) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ProjectListLoadingState />
      </div>
    );
  }

  // Create current date to use for timestamps
  const currentDate = new Date();

  // Create user profile from Clerk user data as SelectUserWithProject type
  const userProfile: SelectUserWithProject = {
    // Project fields (empty since this is a new project)
    id: "",
    title: "",
    slug: "",
    description: "",
    category: "",
    total_favorites: "",
    url_links: null,
    category_data: null,
    field_order: null,
    created_at: new Date(),
    updated_at: currentDate,
    deleted_at: null,

    // User fields
    user_id: ownerId,
    username: user?.username || user?.emailAddresses?.[0]?.emailAddress || "",
    full_name: user?.fullName || "",
    profile_image_url: user?.imageUrl || "",
    tier: "",
    email_address: user?.emailAddresses?.[0]?.emailAddress || "",
  };

  return (
    <ProjectsProvider token={token} userId={ownerId || null} isLoading={false}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <HeaderSection />
          <ProtectedPage allowedTiers={PROTECTED_PAGES_TIERS}>
            <ProjectCreateComponent userProfile={userProfile} />
          </ProtectedPage>
          <FooterSection />
        </SidebarInset>
      </SidebarProvider>
    </ProjectsProvider>
  );
}
