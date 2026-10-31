"use client";

import React from "react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ProjectsProvider } from "@/providers/projects-provider";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import { ProjectCreateComponent } from "@/components/Projects/ProjectComponents/ProjectCreateComponent";
import ProtectedPage from "@/app/auth/ProtectedPage";
import { PROTECTED_PAGES_TIERS } from "@/app/auth/protectedPageConstants";
import { SelectUserWithProject } from "@/types/rows";
import { useViewerId } from "@/components/auth/AuthGate";
import { useDisplayUser } from "@/components/auth/useDisplayUser";

export default function CreateProjectPage() {
  // D08g4e3: the signed-in user's display fields from the app's login.
  const { user } = useDisplayUser();
  // D03: the page follows the Better Auth session; ProtectedPage below sends
  // a signed-out visitor to sign in, and the save goes to Convex, which takes
  // the creator from the session.
  const viewerId = useViewerId();
  const ownerId = viewerId ?? "";

  // Create current date to use for timestamps
  const currentDate = new Date();

  // Create user profile from the signed-in user's data as SelectUserWithProject type
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
    username: user?.username || user?.email || "",
    full_name: user?.fullName || "",
    profile_image_url: user?.imageUrl || "",
    tier: "",
    email_address: user?.email || "",
  };

  return (
    <ProjectsProvider userId={ownerId || null} isLoading={false}>
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
