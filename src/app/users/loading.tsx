import "@/styles/foundations.css";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenericLoadingState } from "@/components/LoadingState/GenericLoadingState";
import { AppShell } from "@/components/layout/AppShell";

export default function UsersLoading() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="flex justify-center w-full mb-20">
          <div className="w-full max-w-7xl mx-auto px-4 2xl:px-8 3xl:px-12">
            <div className="flex flex-col gap-6 mb-6 py-3">
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
                  <div className="space-y-6">
                    {/* Search Input Skeleton */}
                    <div className="relative max-w-2xl mx-auto">
                      <div className="h-12 bg-muted rounded-xl w-full animate-pulse"></div>
                    </div>

                    {/* Top Contributors Section Skeleton */}
                    <div className="mb-8">
                      <div className="flex items-center justify-center gap-3 mb-4">
                        <div className="h-6 w-6 bg-muted rounded animate-pulse"></div>
                        <div className="h-8 w-48 bg-muted rounded animate-pulse"></div>
                      </div>
                      <div className="h-4 w-96 bg-muted rounded mx-auto mb-4 animate-pulse"></div>
                      <div className="flex flex-wrap gap-4 justify-center">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="w-full md:w-[calc(50%-0.5rem)] xl:flex-1 xl:max-w-[calc(33.333%-0.667rem)] max-w-md h-64 bg-muted rounded-lg animate-pulse"
                            style={{ animationDelay: `${i * 100}ms` }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* All Users Grid Skeleton */}
                    <GenericLoadingState
                      type="card"
                      itemsCount={6}
                      className="animate-in fade-in-50"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        </div>
    </AppShell>
  );
}
