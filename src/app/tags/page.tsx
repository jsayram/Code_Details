"use client";

// UI07.2: /tags on the foundations. Tags with projects are real links to
// /tags/<name> (they were Badges with click handlers, out of keyboard reach);
// tags without projects stay listed, readable and not clickable, as before.
// The filter box, its 400ms debounce, the sort (most used, then A to Z) and
// the two groups are unchanged.
import "@/styles/foundations.css";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Hash, Search, X } from "lucide-react";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTags } from "@/hooks/use-tags";
import { HighlightText } from "@/components/HighlightText";
import { AppShell } from "@/components/layout/AppShell";
import { DiscoveryHeader } from "@/components/layout/DiscoveryHeader";

export default function TagsIndexPage() {
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();
  const { tags: allTags, isLoading: tagsLoading, isValidating, error, refreshTags } = useTags();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [clickedTag, setClickedTag] = useState<string | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter and sort tags
  const filteredTags = (allTags || [])
    .filter((tag) => {
      const searchLower = debouncedSearchQuery.toLowerCase().trim();
      if (!searchLower) return true;
      return tag.name.toLowerCase().includes(searchLower);
    })
    .sort((a, b) => {
      if (a.count !== b.count) {
        return (b.count || 0) - (a.count || 0);
      }
      return a.name.localeCompare(b.name);
    });

  // Separate active and inactive tags
  const activeTags = filteredTags.filter((tag) => (tag.count ?? 0) > 0);
  const inactiveTags = filteredTags.filter((tag) => !tag.count || tag.count === 0);
  const failed = Boolean(error) && !tagsLoading && (allTags?.length ?? 0) === 0;

  return (
    <ProjectsProvider userId={viewer.userId}>
      <AppShell>
        <div className="cd-foundations cd-canvas">
          <div className="cd-page cd-stack">
            <DiscoveryHeader
              eyebrow="Explore"
              title="Browse All Tags"
              lead="Discover projects by technology stack and features"
            />

            <div className="cd-search-field cd-search-field-compact cd-reading" style={{ maxWidth: "36rem" }}>
              <Search className="h-5 w-5" aria-hidden="true" />
              <Input
                type="text"
                aria-label="Search tags"
                placeholder="Search tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="cd-search-field-end" onClick={() => setSearchQuery("")} aria-label="Clear tag search">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>

            <p role="status" className="sr-only">
              {tagsLoading ? "Loading tags" : debouncedSearchQuery ? `${filteredTags.length} tags match` : ""}
            </p>

            {failed && (
              <div role="alert" className="cd-surface flex flex-wrap items-center justify-between gap-4" style={{ borderColor: "var(--cd-danger)" }}>
                <div className="cd-stack-tight cd-reading">
                  <p className="cd-subheading">Tags didn&apos;t load</p>
                  <p className="cd-small cd-muted">Try again to see every tag and how many projects use it.</p>
                </div>
                <Button variant="outline" onClick={() => refreshTags()} disabled={isValidating}>
                  {isValidating ? (
                    <>
                      <span aria-hidden="true" className="cd-spinner animate-spin" />
                      Trying again…
                    </>
                  ) : (
                    "Try again"
                  )}
                </Button>
              </div>
            )}

            {/* Active Tags Section */}
            {!failed && (searchQuery || activeTags.length > 0 || tagsLoading) && (
              <section className="cd-surface cd-stack" aria-labelledby="active-tags-title">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="active-tags-title" className="cd-heading">Active Tags</h2>
                  <span className="cd-status cd-number" data-tone="selected">{activeTags.length}</span>
                </div>
                {tagsLoading ? (
                  <div className="cd-cluster" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span key={i} className="cd-skeleton-block animate-pulse h-11 w-24 rounded-full" />
                    ))}
                  </div>
                ) : activeTags.length > 0 ? (
                  <ul className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
                    {activeTags.map((tag) => (
                      <li key={tag.name} className="max-w-full">
                        <Link
                          href={`/tags/${encodeURIComponent(tag.name)}`}
                          className="cd-pill-link"
                          onClick={() => setClickedTag(tag.name)}
                          aria-busy={clickedTag === tag.name || undefined}
                        >
                          {clickedTag === tag.name ? (
                            <span aria-hidden="true" className="cd-spinner animate-spin" />
                          ) : (
                            <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />
                          )}
                          <HighlightText text={tag.name} highlight={debouncedSearchQuery} />
                          <span className="cd-pill-count">{tag.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : searchQuery ? (
                  <p className="cd-muted">No active tags found matching &ldquo;{searchQuery}&rdquo;</p>
                ) : null}
              </section>
            )}

            {/* Inactive Tags Section */}
            {!failed && (searchQuery || inactiveTags.length > 0) && (
              <section className="cd-surface cd-stack" aria-labelledby="available-tags-title">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="available-tags-title" className="cd-heading">Available Tags</h2>
                  <span className="cd-status cd-number" style={{ background: "var(--cd-raised)" }}>{inactiveTags.length}</span>
                </div>
                {inactiveTags.length > 0 ? (
                  <>
                    {!searchQuery && <p className="cd-small cd-muted">Be the first to create projects for these tags! 🚀</p>}
                    <ul className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
                      {inactiveTags.map((tag) => (
                        <li key={tag.name} className="max-w-full">
                          <span className="cd-pill-link" data-inactive="">
                            <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <HighlightText text={tag.name} highlight={debouncedSearchQuery} />
                            <span className="sr-only">, no projects yet</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : searchQuery ? (
                  <p className="cd-muted">No available tags found matching &ldquo;{searchQuery}&rdquo;</p>
                ) : null}
              </section>
            )}

            {/* No results message when searching */}
            {!failed && searchQuery && filteredTags.length === 0 && !tagsLoading && (
              <p className="cd-muted text-center">No tags found matching &ldquo;{searchQuery}&rdquo;</p>
            )}
          </div>
        </div>
      </AppShell>
    </ProjectsProvider>
  );
}
