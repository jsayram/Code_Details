// UI06.2: what the project page shows while it loads: the page's own shape
// (title block, then sections) instead of a list of project cards.
import "@/styles/foundations.css";

const Block = ({ className = "" }: { className?: string }) => (
  <span className={`cd-skeleton-block animate-pulse ${className}`} />
);

export function ProjectPageSkeleton() {
  return (
    <div className="cd-foundations cd-canvas">
      <div className="cd-page cd-stack">
        <p role="status" className="sr-only">
          Loading project
        </p>
        <div aria-hidden="true" className="cd-stack">
          <div className="cd-surface flex flex-col items-center gap-4 sm:flex-row">
            <Block className="h-20 w-20 shrink-0 rounded-full" />
            <div className="flex w-full flex-col gap-3">
              <Block className="h-9 w-3/4" />
              <Block className="h-5 w-40" />
            </div>
          </div>
          <Block className="h-56 w-full" />
          <div className="cd-stack-tight">
            <Block className="h-7 w-48" />
            <Block className="h-4 w-full" />
            <Block className="h-4 w-11/12" />
            <Block className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
