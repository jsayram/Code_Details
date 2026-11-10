// UI07: the /tags loading screen on the foundations, the same shape as the page.
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";

// Fixed widths, so the server and client render the same placeholders.
const activeTagWidths = [120, 108, 106, 123, 92, 119, 119, 138];
const inactiveTagWidths = [78, 72, 80, 80, 87, 88];
const Block = ({ className = "", width }: { className?: string; width?: number }) => (
  <span className={`cd-skeleton-block animate-pulse ${className}`} style={width ? { width } : undefined} />
);

export default function TagsLoading() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <p role="status" className="sr-only">
            Loading tags
          </p>
          <div className="cd-stack" aria-hidden="true">
            <div className="cd-stack-tight">
              <Block className="h-4 w-20" />
              <Block className="h-9 w-64 max-w-full" />
              <Block className="h-6 w-96 max-w-full" />
            </div>
            <Block className="h-11 w-full max-w-xl rounded-[0.625rem]" />
            {[activeTagWidths, inactiveTagWidths].map((widths, i) => (
              <div key={i} className="cd-surface cd-stack">
                <Block className="h-7 w-40" />
                <div className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
                  {widths.map((w, j) => (
                    <Block key={j} className="h-11 rounded-full" width={w} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
