import { AppShell } from "@/components/layout/AppShell";
import { ProjectPageSkeleton } from "./project-page-skeleton";

// UI06.2: the shell stays put while a project page loads. This also covers
// /projects/<slug>/suggest-tags for a moment while that page opens.
export default function ProjectLoading() {
  return (
    <AppShell>
      <ProjectPageSkeleton />
    </AppShell>
  );
}
