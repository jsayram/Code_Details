import "@/styles/foundations.css";
import { getPendingTagSubmissions } from "@/app/actions/tag-submissions";
import { TagSubmissionManagement } from "@/components/administrator/TagSubmissionManagement";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";

// Force dynamic rendering to always get fresh data
export const dynamic = 'force-dynamic';

// UI09.3: in the shared shell (it had none: no sidebar, header or main) and on
// the design foundations. The proxy and getPendingTagSubmissions still check
// for an admin, as before.
export default async function TagSubmissionsPage() {
  const submissions = await getPendingTagSubmissions();

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <DiscoveryHeader eyebrow="System Administration" title="Tag Submissions" lead="Review tags people suggested for their projects." />
          <TagSubmissionManagement initialSubmissions={submissions} />
        </div>
      </div>
    </AppShell>
  );
}
