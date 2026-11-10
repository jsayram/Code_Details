// UI08.1: the dashboard's placeholder, shared by the route's loading.tsx and
// the page while its data loads. It's the page's shape with nothing to click,
// hidden from screen readers behind one "Loading your dashboard" status. No
// <main> of its own: the shell already has one (UI02: the old one made two).
import "@/styles/foundations.css";

const Block = ({ className = "" }: { className?: string }) => (
  <span className={`cd-skeleton-block animate-pulse ${className}`} />
);

export function DashboardSkeleton() {
  return (
    <div className="cd-stack" aria-busy="true">
      <header className="cd-page-header">
        <div className="cd-stack-tight w-full max-w-xl">
          <Block className="h-4 w-40" />
          <h1 className="cd-title">Personal Analytics Dashboard</h1>
          <p role="status" className="cd-lead cd-muted">
            Loading your dashboard
          </p>
        </div>
      </header>
      <div aria-hidden="true" className="cd-stack">
        <div className="cd-surface flex items-center gap-4">
          <Block className="h-16 w-16 rounded-full" />
          <div className="cd-stack-tight flex-1">
            <Block className="h-5 w-40" />
            <Block className="h-4 w-56 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="cd-surface cd-stack-tight">
              <Block className="h-4 w-24" />
              <Block className="h-10 w-16" />
              <Block className="h-3 w-28 max-w-full" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="cd-surface cd-stack-tight">
              <Block className="h-5 w-40" />
              <Block className="h-3 w-52 max-w-full" />
              {Array.from({ length: 4 }).map((__, j) => (
                <Block key={j} className="h-12 w-full" />
              ))}
            </div>
          ))}
        </div>
        <div className="cd-surface cd-stack-tight">
          <Block className="h-6 w-56 max-w-full" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
