"use client";

// UI09.3: a page that crashes says so inside the shell and offers Try again,
// instead of falling through to the root ErrorBoundary (UI02: there was no
// error.tsx outside the project page). The error's text isn't shown; in
// production it's a generic message anyway, and the details stay in the console.
import "@/styles/foundations.css";
import { useEffect } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <div role="alert" className="cd-surface cd-stack-tight" style={{ borderColor: "var(--cd-danger)" }}>
            <h1 className="cd-heading">This page didn&apos;t load</h1>
            <p className="cd-muted cd-reading">Something went wrong on our side. Try again, or come back in a moment.</p>
            <div className="cd-cluster pt-2">
              <Button onClick={() => retry()}>Try again</Button>
              <Button variant="outline" asChild>
                <Link href="/">Back to Home</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
