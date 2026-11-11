import "@/styles/foundations.css";
import { Card } from "@/components/ui/card";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoriesIntro } from "./categories-intro";
import { AppShell } from "@/components/layout/AppShell";

// Same layout as the page, with the counts and buttons still to come.
export default function CategoriesLoading() {
  return (
    <AppShell>
        <div className="cd-foundations cd-canvas">
          <div className="cd-page cd-stack">
            <CategoriesIntro />
            <p role="status" className="sr-only">
              Loading categories
            </p>
            <ul className="cd-grid" aria-busy="true">
              {Object.entries(PROJECT_CATEGORIES).map(([key, category]) => (
                <li key={key} className="flex min-w-0">
                  <Card className="cd-wrap w-full gap-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="cd-subheading min-w-0">{category.label}</h2>
                      <Skeleton aria-hidden="true" className="h-7 w-24 shrink-0 rounded-full" />
                    </div>
                    <p className="cd-small cd-muted flex-1">{category.description}</p>
                    <Skeleton aria-hidden="true" className="h-11 w-full rounded-full" />
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </AppShell>
  );
}
