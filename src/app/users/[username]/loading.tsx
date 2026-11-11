import "@/styles/foundations.css";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

// UI06.3: the profile's own shape while it loads, inside the shared shell.
export default function UserProfileLoading() {
  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <p role="status" className="sr-only">
            Loading profile
          </p>
          <div aria-hidden="true" className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="cd-surface flex flex-col items-center gap-4">
              <Skeleton className="h-24 w-24 rounded-full" />
              <Skeleton className="h-7 w-40" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-2">
              {[0, 1].map((i) => (
                <div key={i} className="cd-surface flex flex-col gap-2">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-9 w-16" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
