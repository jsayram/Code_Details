"use client";

import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import "@/styles/foundations.css";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserList } from "@/components/UserList";
import { AppShell } from "@/components/layout/AppShell";

export default function UsersIndexPage() {
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();

  return (
    <ProjectsProvider userId={viewer.userId}>
      <AppShell>
        <div className="cd-foundations cd-canvas">
          <div className="flex justify-center w-full mb-20">
            <div className="w-full max-w-7xl mx-auto px-4 2xl:px-8 3xl:px-12">
              <div className="flex flex-col gap-6 mb-6 py-3">
                {/* UI09.3: the shared header (one h1) in place of the gradient banner. */}
                <DiscoveryHeader
                  eyebrow="Community"
                  icon={<Users className="h-8 w-8" style={{ color: "var(--cd-action)" }} />}
                  title="Browse by Users"
                  lead="Discover projects by their creators and contributors"
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
        </div>
      </AppShell>
    </ProjectsProvider>
  );
}
