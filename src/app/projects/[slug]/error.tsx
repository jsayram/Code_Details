"use client";

// UI06.2: a project page that fails to load says so and offers Try again,
// inside the shell, instead of falling through to the root error boundary.
import "@/styles/foundations.css";
import { useEffect } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";

export default function ProjectError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <div role="alert" className="cd-surface cd-stack-tight" style={{ borderColor: "var(--cd-danger)" }}>
            <h1 className="cd-heading">This project didn&apos;t load</h1>
            <p className="cd-muted cd-reading">
              Something went wrong on our side. Try again, or come back in a moment.
            </p>
            <div className="cd-cluster pt-2">
              <Button onClick={() => retry()}>Try again</Button>
              <Button variant="outline" asChild>
                <Link href="/projects">Browse projects</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
