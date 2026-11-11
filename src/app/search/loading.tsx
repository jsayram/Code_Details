// UI07.1: /search placeholders on the foundations. SearchContentSkeleton is
// the results area only (the page shows it under its own header while the
// tags, counts and people load); the route's loading screen adds the header.
import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";

const Block = ({ className = "" }: { className?: string }) => <span className={`cd-skeleton-block animate-pulse ${className}`} />;

export function SearchContentSkeleton() {
  return (
    <div className="cd-stack">
      <p role="status" className="sr-only">
        Loading results
      </p>
      <div className="cd-stack" aria-hidden="true">
        <Block className="mx-auto h-11 w-full max-w-md rounded-full" />
        {/* People, tags, categories */}
        <div className="cd-surface cd-stack">
          <Block className="h-7 w-32" />
          <div className="cd-grid" style={{ ["--cd-card-min" as string]: "16rem" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="cd-tile flex-row items-center gap-3">
                <Block className="h-12 w-12 shrink-0 rounded-full" />
                <span className="flex-1 cd-stack-tight">
                  <Block className="h-5 w-3/4" />
                  <Block className="h-4 w-1/2" />
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="cd-surface cd-stack">
          <Block className="h-7 w-24" />
          <div className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
            {[96, 80, 112, 72, 104, 88, 120, 76].map((w) => (
              <span key={w} className="cd-skeleton-block animate-pulse h-11 rounded-full" style={{ width: w }} />
            ))}
          </div>
        </div>
        <div className="cd-surface cd-stack">
          <Block className="h-7 w-36" />
          <div className="cd-grid">
            {[0, 1].map((i) => (
              <div key={i} className="cd-tile">
                <Block className="h-6 w-2/3" />
                <Block className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPageLoading() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <div className="cd-surface flex flex-col items-center gap-6 lg:flex-row" aria-hidden="true">
            <Block className="h-36 w-28 shrink-0 lg:h-52 lg:w-40" />
            <div className="cd-stack w-full">
              <Block className="h-9 w-72 max-w-full" />
              <Block className="h-5 w-full max-w-xl" />
              <Block className="h-14 w-full rounded-[0.625rem]" />
            </div>
          </div>
          <SearchContentSkeleton />
        </div>
      </div>
    </AppShell>
  );
}
