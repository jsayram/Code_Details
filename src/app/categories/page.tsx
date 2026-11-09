"use client";

// UI04: the first screen on the UI03 foundations. UI05: the shared shell
// around it (AppShell) is on the foundations too, so the old seam is gone.
import "@/styles/foundations.css";
import { Card } from "@/components/ui/card";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { useCategoryCounts } from "@/hooks/use-category-counts";
import { cn } from "@/lib/utils";
import { CategoriesIntro } from "./categories-intro";
import { AppShell } from "@/components/layout/AppShell";

function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

// Component that fetches and displays category counts
function CategoriesContent() {
  const router = useRouter();
  const { categoryCounts, isLoading, isValidating, error, refreshCounts } = useCategoryCounts();
  const [loadingCategories, setLoadingCategories] = useState<Record<string, boolean>>({});
  // Without counts we can't tell an empty category from a failed request, so
  // every category stays open and the page says the counts are missing.
  const countsFailed = Boolean(error) && !isLoading;

  const handleCategoryClick = (key: string, canOpen: boolean) => {
    if (!canOpen) return;
    setLoadingCategories((prev) => ({ ...prev, [key]: true }));
    router.push(`/categories/${encodeURIComponent(key)}`);
  };

  return (
    <div className="cd-foundations cd-canvas">
      <div className="cd-page cd-stack">
        <CategoriesIntro />

        <p role="status" className="sr-only">
          {isLoading ? "Loading project counts" : ""}
        </p>

        {countsFailed && (
          <div role="alert" className="cd-surface flex flex-wrap items-center justify-between gap-4" style={{ borderColor: "var(--cd-danger)" }}>
            <div className="cd-stack-tight cd-reading">
              <p className="cd-subheading">Project counts didn&apos;t load</p>
              <p className="cd-small cd-muted">You can still open any category. Try again to see how many projects each one has.</p>
            </div>
            <Button variant="outline" onClick={() => refreshCounts()} disabled={isValidating}>
              {isValidating ? (
                <>
                  <Spinner />
                  Trying again…
                </>
              ) : (
                "Try again"
              )}
            </Button>
          </div>
        )}

        <ul className="cd-grid" aria-busy={isLoading || undefined}>
          {Object.entries(PROJECT_CATEGORIES).map(([key, category]) => {
            const count = categoryCounts[key] || 0;
            const hasProjects = count > 0;
            const canOpen = countsFailed || (!isLoading && hasProjects);
            const opening = loadingCategories[key];

            return (
              <li key={key} className="flex min-w-0">
                <Card
                  data-category={key}
                  className={cn(
                    "cd-wrap w-full gap-4 p-5 transition-colors",
                    canOpen ? "cursor-pointer hover:border-[var(--cd-border-control)]" : "cursor-default",
                  )}
                  onClick={() => handleCategoryClick(key, canOpen)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="cd-subheading min-w-0">{category.label}</h2>
                    {isLoading ? (
                      <Skeleton aria-hidden="true" className="h-7 w-24 shrink-0 rounded-full" />
                    ) : countsFailed ? null : (
                      <span
                        className={cn("cd-status cd-number shrink-0 whitespace-nowrap", !hasProjects && "cd-muted")}
                        data-tone={hasProjects ? "selected" : undefined}
                        style={hasProjects ? undefined : { background: "var(--cd-raised)" }}
                      >
                        {count} {count === 1 ? "project" : "projects"}
                      </span>
                    )}
                  </div>
                  <p className="cd-small cd-muted flex-1">{category.description}</p>
                  {isLoading ? (
                    <Skeleton aria-hidden="true" className="h-11 w-full rounded-full" />
                  ) : (
                    <Button variant={canOpen ? "default" : "outline"} className="w-full" disabled={!canOpen || opening}>
                      {opening ? (
                        <>
                          <Spinner />
                          Loading...
                        </>
                      ) : canOpen ? (
                        `Browse ${category.label}`
                      ) : (
                        "No projects yet"
                      )}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// Main page component
export default function CategoriesIndexPage() {
  return (
    <AppShell>
        <CategoriesContent />
      </AppShell>
  );
}
