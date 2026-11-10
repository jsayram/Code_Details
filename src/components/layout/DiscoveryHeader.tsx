// UI07: the header the discovery and list pages share, replacing PageBanner's
// gradients. One h1 per page, an eyebrow, a lead and an optional aside (the
// member tier on personal lists, a count). Solid text only.
import "@/styles/foundations.css";
import type { ReactNode } from "react";

interface DiscoveryHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
  icon?: ReactNode;
}

export function DiscoveryHeader({ eyebrow, title, lead, aside, icon }: DiscoveryHeaderProps) {
  return (
    <header className="cd-page-header">
      <div className="cd-stack-tight cd-reading">
        {eyebrow && <p className="cd-small cd-muted">{eyebrow}</p>}
        <h1 className="cd-title cd-wrap flex items-center gap-3">
          {icon && (
            <span aria-hidden="true" className="inline-flex shrink-0">
              {icon}
            </span>
          )}
          <span className="min-w-0">{title}</span>
        </h1>
        {lead && <div className="cd-lead cd-muted">{lead}</div>}
      </div>
      {aside && <div className="cd-cluster">{aside}</div>}
    </header>
  );
}

/** "pro member" and the like, as a status pill (the old banner's badge failed contrast). */
export function TierStatus({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  return (
    <span className="cd-status" data-tone="selected">
      {tier} member
    </span>
  );
}
