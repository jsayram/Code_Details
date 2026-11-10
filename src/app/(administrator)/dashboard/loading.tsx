// UI08.1: the route's loading screen inside the shell, with the dashboard's
// own placeholder. It used to render a bare <main> outside the shell, and the
// page reused it inside the shell's <main> (two main regions, UI02).
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";

export default function UserDashboardLoading() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page">
          <DashboardSkeleton />
        </div>
      </div>
    </AppShell>
  );
}
