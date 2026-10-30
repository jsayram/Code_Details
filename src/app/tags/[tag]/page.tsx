"use client";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSupabaseToken } from "@/hooks/use-SupabaseClerkJWTToken";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { ProjectList } from "@/components/Projects";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";
import { useState, useEffect, use } from "react";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import { PageBanner } from "@/components/ui/page-banner";
import { Tag } from "lucide-react";

interface PageProps {
  params: Promise<{ tag: string }>;
}

export default function TagPage({ params }: PageProps) {
  const resolvedParams = params instanceof Promise ? use(params) : params;
  const { token, loading: tokenLoading } = useSupabaseToken();
  // D07x/D08g4e3: the app's login (Clerk or Better Auth) and, with Clerk, the Supabase token.
  const viewer = usePersonalPageViewer({ token, tokenLoading });
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);
  const [decodedTag, setDecodedTag] = useState<string>("");

  useEffect(() => {
    if (resolvedParams.tag) {
      // Normalize tag name: decode URL and convert to lowercase for case-insensitive matching
      const normalizedTag = decodeURIComponent(resolvedParams.tag).toLowerCase().trim();
      setDecodedTag(normalizedTag);
    }
  }, [resolvedParams.tag]);

  // Determine overall loading state
  const isLoading = viewer.isLoading || !decodedTag;

  return (
    <>
      {isLoading ? (
        <div className="container mx-auto px-4 py-">
          <ProjectListLoadingState />
        </div>
      ) : (
        <ProjectsProvider
          token={viewer.token}
          userId={viewer.userId}
          isLoading={isLoading}
          initialFilters={{ tags: [decodedTag] }}
        >
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <HeaderSection />
              <div className="flex justify-center w-full mb-20">
                <div className="w-full px-4 2xl:px-8 3xl:px-12">
                  <div className="flex flex-col gap-4 mb-6 py-3">
                    <div className="mb-8">
                      <div className="flex flex-col space-y-4">
                        <PageBanner
                          icon={<Tag className="h-8 w-8 text-primary" />}
                          bannerTitle={`Projects Tagged with "${decodedTag}"`}
                          description="Browse projects with this tag"
                          isUserBanner={false}
                          gradientFrom="indigo-900"
                          gradientVia="blue-800"
                          gradientTo="purple-800"
                          borderColor="border-indigo-700/40"
                          textGradient="from-fuchsia-400 via-indigo-400 to-cyan-400"
                        />
                        <ProjectList
                          currentPage={currentPage}
                          showSortingFilters={true}
                          onPageChange={setCurrentPage}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <FooterSection />
            </SidebarInset>
          </SidebarProvider>
        </ProjectsProvider>
      )}
    </>
  );
}