// UI07: this route's own loading screen. Without it the parent index's
// skeleton showed while a single list opened (DESIGN.md, lessons from /categories).
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";
import { ProjectListLoadingState } from "@/components/LoadingState/ProjectListLoadingState";

export default function ListLoading() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <div className="cd-stack-tight" aria-hidden="true">
            <span className="cd-skeleton-block animate-pulse h-4 w-20" />
            <span className="cd-skeleton-block animate-pulse h-9 w-80 max-w-full" />
            <span className="cd-skeleton-block animate-pulse h-6 w-96 max-w-full" />
          </div>
          <ProjectListLoadingState />
        </div>
      </div>
    </AppShell>
  );
}
