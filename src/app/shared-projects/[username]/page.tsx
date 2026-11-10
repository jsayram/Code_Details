"use client";

// UI06.3: the public profile, the page a shared link opens. On the UI03
// foundations and the shared AppShell. Signed-out visitors see the same
// public projects as before; nothing here needs a sign-in.
import "@/styles/foundations.css";
import { useState } from "react";
import { useParams } from "next/navigation";
import { CURRENT_PAGE } from "@/components/navigation/Pagination/paginationConstants";
import { SharedProjectsGrid } from "@/components/Projects/SharedProjectsGrid";
import { AppShell } from "@/components/layout/AppShell";

export default function SharedProjects() {
  const [currentPage, setCurrentPage] = useState(CURRENT_PAGE);
  const [total, setTotal] = useState<number | null>(null);
  const params = useParams();
  const username = params?.username as string;

  if (!username) {
    return <div>Invalid username</div>;
  }

  const decodedUsername = decodeURIComponent(username);

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        <div className="cd-page cd-stack">
          <header className="cd-stack-tight">
            <p className="cd-small cd-muted">Shared projects</p>
            <h1 className="cd-title cd-wrap">{decodedUsername}</h1>
            <p className="cd-lead cd-muted cd-reading">
              Explore the projects shared by this user. You can find a variety of projects that showcase their skills and creativity.
            </p>
            {total !== null && total > 0 && (
              <p className="cd-small cd-number">
                {total} {total === 1 ? "project" : "projects"}
              </p>
            )}
          </header>
          <SharedProjectsGrid
            username={decodedUsername}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onTotalChange={setTotal}
          />
        </div>
      </div>
    </AppShell>
  );
}
