"use client";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSupabaseToken } from "@/hooks/use-supabase-token";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import { PageBanner } from "@/components/ui/page-banner";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserList } from "@/components/UserList";

export default function UsersIndexPage() {
  const { token, loading: tokenLoading } = useSupabaseToken();
  // D07x/D08g4e3: the app's login (Clerk or Better Auth) and, with Clerk, the Supabase token.
  const viewer = usePersonalPageViewer({ token, tokenLoading });

  return (
    <ProjectsProvider token={viewer.token} userId={viewer.userId}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <HeaderSection />
          <div className="flex justify-center w-full mb-20">
            <div className="w-full max-w-7xl mx-auto px-4 2xl:px-8 3xl:px-12">
              <div className="flex flex-col gap-6 mb-6 py-3">
                <PageBanner
                  icon={<Users className="h-8 w-8 text-primary" />}
                  bannerTitle="Browse by Users"
                  description="Discover projects by their creators and contributors"
                  isUserBanner={false}
                  gradientFrom="indigo-900"
                  gradientVia="blue-800"
                  gradientTo="purple-800"
                  borderColor="border-indigo-700/40"
                  textGradient="from-fuchsia-400 via-indigo-400 to-cyan-400"
                />

                <Card>
                  <CardHeader className="text-center">
                    <CardTitle>All Contributing Users</CardTitle>
                    <p className="text-sm text-muted-foreground mt-2">
                      Users who have shared projects with the community
                    </p>
                  </CardHeader>
                  <CardContent>
                    <UserList />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
          <FooterSection />
        </SidebarInset>
      </SidebarProvider>
    </ProjectsProvider>
  );
}
