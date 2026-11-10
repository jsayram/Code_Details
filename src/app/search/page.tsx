"use client";

// UI07.1: /search on AppShell and the foundations.
// - Every result is a real link (categories, tags, people and the three
//   explore shortcuts were divs or Badges with click handlers, out of keyboard
//   reach). Items with nothing to open stay listed and are not links, as before.
// - The mascot goes through next/image: the page used to ship the 3.4MB PNG
//   (UI02 defect 9), and the full-screen particles are gone (DESIGN: particles
//   on home only).
// - The result count is announced, and a list that failed to load says so.
// Unchanged: the query lives in component state (no URL), the 400ms debounce,
// local filtering of categories, tags and people, the project results and
// their ranking from /api/search, the tabs, and every limit and order.
import "@/styles/foundations.css";
import Image from "next/image";
import Link from "next/link";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import { Search, Hash, Folder, Users, X } from "lucide-react";
import { usePersonalPageViewer } from "@/components/auth/usePersonalPageViewer";
import { ProjectsProvider } from "@/providers/projects-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROJECT_CATEGORIES, categorySummary } from "@/constants/project-categories";
import { useTags } from "@/hooks/use-tags";
import { useCategoryCounts } from "@/hooks/use-category-counts";
import { useProfiles } from "@/hooks/use-profiles";
import { HighlightText } from "@/components/HighlightText";
import { ProjectSearchResults } from "@/components/search/ProjectSearchResults";
import { AppShell } from "@/components/layout/AppShell";
import { SearchContentSkeleton } from "./loading";

type UserRow = {
  username: string;
  profileImage: string | null;
  fullName: string | null;
  projectCount: number;
  totalFavorites: number;
  lastActivityDate: Date | null;
  isActive: boolean;
  score: number;
  createdAt: Date | null;
};

function Spinner() {
  return <span aria-hidden="true" className="cd-spinner animate-spin" />;
}

function Avatar({ user }: { user: UserRow }) {
  const [broken, setBroken] = useState(false);
  if (user.profileImage && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from several hosts; same element as before
    return <img src={user.profileImage} alt="" className="cd-avatar" onError={() => setBroken(true)} loading="lazy" />;
  }
  return (
    <span className="cd-avatar" aria-hidden="true">
      {user.username[0]?.toUpperCase()}
    </span>
  );
}

/** One person: a link to their profile when they have projects, otherwise listed only. */
function UserTile({ user, query, rank, opening, onOpen }: { user: UserRow; query: string; rank?: number; opening: boolean; onOpen: () => void }) {
  const medals = ["🥇", "🥈", "🥉"];
  const places = ["1st Place", "2nd Place", "3rd Place"];
  const body = (
    <div className="flex items-start gap-3 min-w-0">
      <span className="relative">
        <Avatar user={user} />
        {rank !== undefined && rank < 3 && (
          <span className="absolute -top-2 -right-2 text-xl" role="img" aria-label={places[rank]} title={places[rank]}>
            {medals[rank]}
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0 cd-stack-tight" style={{ gap: "var(--cd-space-1)" }}>
        <h3 className="cd-subheading cd-wrap">
          <HighlightText text={user.username} highlight={query} />
        </h3>
        {user.fullName && <p className="cd-small cd-muted cd-wrap">{user.fullName}</p>}
        <div className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
          {user.projectCount > 0 ? (
            <span className="cd-status cd-number" data-tone="selected">
              {user.projectCount} {user.projectCount === 1 ? "project" : "projects"}
            </span>
          ) : (
            <span className="cd-status" style={{ background: "var(--cd-raised)" }}>No projects</span>
          )}
          {user.totalFavorites > 0 && (
            <span className="cd-status cd-number" style={{ background: "var(--cd-raised)" }}>
              <span aria-hidden="true">⭐</span> {user.totalFavorites}
              <span className="sr-only"> favorites</span>
            </span>
          )}
          {user.isActive && <span className="cd-status" data-tone="success">Active</span>}
        </div>
      </div>
      {opening && <Spinner />}
    </div>
  );
  if (user.projectCount === 0) {
    return (
      <div className="cd-tile" data-inactive="">
        {body}
      </div>
    );
  }
  return (
    <Link href={`/users/${encodeURIComponent(user.username)}`} className="cd-tile" onClick={onOpen} aria-busy={opening || undefined}>
      {body}
    </Link>
  );
}

function TagPill({ tag, query, opening, onOpen }: { tag: { name: string; count?: number }; query: string; opening: boolean; onOpen: () => void }) {
  const isActive = (tag.count ?? 0) > 0;
  const inner = (
    <>
      {opening ? <Spinner /> : <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <HighlightText text={tag.name} highlight={query} />
      {isActive ? <span className="cd-pill-count">{tag.count}</span> : <span className="sr-only">, no projects yet</span>}
    </>
  );
  return isActive ? (
    <Link href={`/tags/${encodeURIComponent(tag.name)}`} className="cd-pill-link" onClick={onOpen} aria-busy={opening || undefined}>
      {inner}
    </Link>
  ) : (
    <span className="cd-pill-link" data-inactive="">
      {inner}
    </span>
  );
}

function CategoryTile({ catKey, label, description, count, query, opening, onOpen }: { catKey: string; label: string; description: string; count: number; query: string; opening: boolean; onOpen: () => void }) {
  const body = (
    <>
      <div className="cd-tile-row">
        <h3 className="cd-subheading cd-wrap flex items-start gap-2 min-w-0">
          <span className="cd-cat cd-cat-dot" data-category={catKey} aria-hidden="true" />
          <span className="min-w-0">
            <HighlightText text={label} highlight={query} />
          </span>
        </h3>
        <span className={`cd-status cd-number shrink-0${count > 0 ? "" : " cd-muted"}`} data-tone={count > 0 ? "selected" : undefined} style={count > 0 ? undefined : { background: "var(--cd-raised)" }}>
          {count} <span className="sr-only">{count === 1 ? "project" : "projects"}</span>
        </span>
      </div>
      <p className="cd-small cd-muted">{description}</p>
      {opening && (
        <span className="cd-small flex items-center gap-2">
          <Spinner />
          Loading...
        </span>
      )}
    </>
  );
  // Empty categories don't open, as before.
  return count > 0 ? (
    <Link href={`/categories/${encodeURIComponent(catKey)}`} className="cd-tile" onClick={onOpen} aria-busy={opening || undefined}>
      {body}
    </Link>
  ) : (
    <div className="cd-tile" data-inactive="">
      {body}
    </div>
  );
}

function Group({ id, icon, title, count, children }: { id: string; icon: ReactNode; title: string; count: number; children: ReactNode }) {
  return (
    <section className="cd-surface cd-stack" aria-labelledby={id}>
      <h2 id={id} className="cd-heading flex items-center gap-2">
        <span aria-hidden="true" className="inline-flex">{icon}</span>
        {title}
        <span className="cd-status cd-number" data-tone="selected">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function SearchContent({ signedIn }: { signedIn: boolean }) {
  const { tags: allTags, isLoading: tagsLoading, error: tagsError, refreshTags } = useTags();
  const { categoryCounts, isLoading: categoryCountsLoading, error: countsError, refreshCounts } = useCategoryCounts();
  const { profiles, isLoading: profilesLoading, error: profilesError, refreshProfiles } = useProfiles();
  const [searchQuery, setSearchQuery] = useState("");
  const [projectCount, setProjectCount] = useState(0);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [loadingItem, setLoadingItem] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      // Reset to the initial state when the search is cleared
      setHasSearched(Boolean(searchQuery.trim()));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredCategories = useMemo(() => {
    const searchLower = debouncedSearchQuery.toLowerCase().trim();
    const allCategories = Object.entries(PROJECT_CATEGORIES);
    // C01: every category (22 now). This used to stop at 20.
    if (!searchLower) return allCategories;
    return allCategories.filter(([key, category]) => category.label.toLowerCase().includes(searchLower) || key.toLowerCase().includes(searchLower));
  }, [debouncedSearchQuery]);

  // Tags: up to 30, most used first, then tags with no projects A to Z.
  const filteredTags = useMemo(() => {
    const searchLower = debouncedSearchQuery.toLowerCase().trim();
    const tags = allTags || [];
    const sortedActiveTags = tags.filter((tag) => (tag.count || 0) > 0).sort((a, b) => (b.count || 0) - (a.count || 0));
    const sortedInactiveTags = tags.filter((tag) => !tag.count || tag.count === 0).sort((a, b) => a.name.localeCompare(b.name));
    const matches = (name: string) => !searchLower || name.toLowerCase().includes(searchLower);
    const top30Active = sortedActiveTags.filter((t) => matches(t.name)).slice(0, 30);
    const remainingSlots = 30 - top30Active.length;
    const additionalTags = remainingSlots > 0 ? sortedInactiveTags.filter((t) => matches(t.name)).slice(0, remainingSlots) : [];
    return [...top30Active, ...additionalTags];
  }, [allTags, debouncedSearchQuery]);

  // People, ranked by the API's stats: projects 100, favorites 50, active in the last 7 days 5.
  const { activeUsers, inactiveUsers, totalInactiveCount } = useMemo(() => {
    const validProfiles = profiles.filter((p) => p.username);
    if (!validProfiles.length) return { activeUsers: [] as UserRow[], inactiveUsers: [] as UserRow[], totalInactiveCount: 0 };

    const searchLower = debouncedSearchQuery.toLowerCase().trim();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const allUsers: UserRow[] = validProfiles.map((profile) => {
      const lastActivity = profile.last_activity_date ? new Date(profile.last_activity_date) : null;
      const isActive = lastActivity ? lastActivity >= sevenDaysAgo : false;
      return {
        username: profile.username!,
        profileImage: profile.profile_image_url || null,
        fullName: profile.full_name || null,
        projectCount: profile.project_count,
        totalFavorites: profile.total_favorites,
        lastActivityDate: lastActivity,
        isActive,
        score: profile.project_count * 100 + profile.total_favorites * 50 + (isActive ? 5 : 0),
        createdAt: profile.created_at ? new Date(profile.created_at) : null,
      };
    });

    const sortedActive = allUsers.filter((u) => u.projectCount > 0).sort((a, b) => b.score - a.score);
    // People with no projects, newest account first
    const sortedInactive = allUsers
      .filter((u) => u.projectCount === 0)
      .sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    // Username and full name only (D04a: profiles carry no email any more)
    const matchesSearch = (user: UserRow) => !searchLower || user.username.toLowerCase().includes(searchLower) || !!user.fullName?.toLowerCase().includes(searchLower);
    const filteredInactive = sortedInactive.filter(matchesSearch);
    return { activeUsers: sortedActive.filter(matchesSearch).slice(0, 30), inactiveUsers: filteredInactive, totalInactiveCount: filteredInactive.length };
  }, [profiles, debouncedSearchQuery]);

  // D09 S02e: project results count too (0 while search is switched off).
  const totalResults = projectCount + filteredCategories.length + filteredTags.length + activeUsers.length + inactiveUsers.length;
  const userCount = activeUsers.length + inactiveUsers.length;

  const isSearching = debouncedSearchQuery !== searchQuery;
  const isLoadingData = tagsLoading || categoryCountsLoading || profilesLoading;
  const showEmptyState = !hasSearched && !debouncedSearchQuery.trim();
  const q = debouncedSearchQuery;
  // A list that failed shows as a failure, not as "no results" (UI02 defect 4's pattern).
  // The people list needs a session (/api/profiles answers 401 signed out), so
  // signed out it is simply absent, as before, and not reported as a failure.
  const peopleFailed = signedIn && Boolean(profilesError);
  const failedLists = [tagsError && "tags", countsError && "category counts", peopleFailed && "people"].filter(Boolean) as string[];
  const retryFailed = () => {
    if (tagsError) void refreshTags();
    if (countsError) void refreshCounts();
    if (peopleFailed) void refreshProfiles();
  };

  const open = (id: string) => () => setLoadingItem(id);

  const userGrid = (users: UserRow[], ranked = false, offset = 0) => (
    <ul className="cd-grid" style={{ ["--cd-card-min" as string]: "16rem" }}>
      {users.map((user, i) => (
        <li key={user.username} className="min-w-0">
          <UserTile user={user} query={q} rank={ranked ? i + offset : undefined} opening={loadingItem === `user-${user.username}`} onOpen={open(`user-${user.username}`)} />
        </li>
      ))}
    </ul>
  );
  const tagList = (
    <ul className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
      {filteredTags.map((tag) => (
        <li key={tag.name} className="max-w-full">
          <TagPill tag={tag} query={q} opening={loadingItem === `tag-${tag.name}`} onOpen={open(`tag-${tag.name}`)} />
        </li>
      ))}
    </ul>
  );
  const categoryGrid = (
    <ul className="cd-grid">
      {filteredCategories.map(([key, category]) => (
        <li key={key} className="min-w-0">
          <CategoryTile catKey={key} label={category.label} description={categorySummary(category.description)} count={categoryCounts[key] || 0} query={q} opening={loadingItem === `category-${key}`} onOpen={open(`category-${key}`)} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="cd-foundations cd-canvas">
      <div className="cd-page cd-stack">
        {/* Header: the mascot, the search field and what it finds */}
        <section className="cd-surface flex flex-col items-center gap-6 lg:flex-row lg:items-center" aria-labelledby="search-title">
          <Image
            src="/images/mascot.png"
            alt="Code Details Mascot"
            width={160}
            height={207}
            sizes="(min-width: 1024px) 160px, 112px"
            className="h-auto w-28 shrink-0 lg:w-40"
            loading="eager"
          />
          <div className="cd-stack w-full min-w-0">
            <div className="cd-stack-tight">
              <h1 id="search-title" className="cd-title">Search Code Details</h1>
              <p className="cd-lead cd-muted cd-reading">
                Hey there! 👋 I can help you find what you&apos;re looking for. Search projects, categories, tags and people: just type a keyword.
              </p>
            </div>
            <div className="cd-search-field" role="search">
              <Search className="h-6 w-6" aria-hidden="true" />
              <Input
                type="text"
                aria-label="Search Code Details"
                placeholder="Search categories, tags, or users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {isSearching ? (
                <span className="cd-search-field-end" role="status" aria-label="Searching">
                  <Spinner />
                </span>
              ) : (
                searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} className="cd-search-field-end" aria-label="Clear search">
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                )
              )}
            </div>
          </div>
        </section>

        {/* The count is announced when it changes */}
        <div role="status" className="cd-cluster justify-center cd-small cd-muted" style={{ gap: "var(--cd-space-2)" }}>
          {q && !showEmptyState && !isLoadingData && (
            <>
              <span>Found {totalResults} results</span>
              {projectCount > 0 && <span className="cd-status cd-number" style={{ background: "var(--cd-raised)" }}>{projectCount} projects</span>}
              <span className="cd-status cd-number" style={{ background: "var(--cd-raised)" }}>{filteredCategories.length} categories</span>
              <span className="cd-status cd-number" style={{ background: "var(--cd-raised)" }}>{filteredTags.length} tags</span>
              <span className="cd-status cd-number" style={{ background: "var(--cd-raised)" }}>{userCount} users</span>
            </>
          )}
        </div>

        {!showEmptyState && failedLists.length > 0 && !isLoadingData && (
          <div role="alert" className="cd-surface flex flex-wrap items-center justify-between gap-4" style={{ borderColor: "var(--cd-danger)" }}>
            <div className="cd-stack-tight cd-reading">
              <p className="cd-subheading">Some results didn&apos;t load</p>
              <p className="cd-small cd-muted">The {failedLists.join(", ")} couldn&apos;t be fetched, so this list may be missing matches.</p>
            </div>
            <Button variant="outline" onClick={retryFailed}>
              Try again
            </Button>
          </div>
        )}

        {showEmptyState ? (
          /* Nothing typed yet: three ways to explore */
          <section className="cd-stack" aria-labelledby="explore-title">
            <h2 id="explore-title" className="cd-heading text-center">Ready to explore?</h2>
            <ul className="cd-grid" style={{ ["--cd-card-min" as string]: "14rem" }}>
              {[
                { id: "explore-categories", href: "/categories", icon: <Folder className="h-8 w-8" />, title: "Categories", text: "Browse projects by category like Web Development, AI/ML, and more" },
                { id: "explore-tags", href: "/tags", icon: <Hash className="h-8 w-8" />, title: "Tags", text: "Find projects tagged with technologies like React, Python, Docker" },
                { id: "explore-users", href: "/users", icon: <Users className="h-8 w-8" />, title: "Users", text: "Discover talented developers and explore their projects" },
              ].map((t) => (
                <li key={t.id} className="min-w-0">
                  <Link href={t.href} className="cd-tile items-center text-center" onClick={open(t.id)} aria-busy={loadingItem === t.id || undefined}>
                    <span aria-hidden="true" style={{ color: "var(--cd-action)" }}>
                      {loadingItem === t.id ? <Spinner /> : t.icon}
                    </span>
                    <h3 className="cd-subheading">{t.title}</h3>
                    <p className="cd-small cd-muted">{t.text}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : isLoadingData ? (
          <SearchContentSkeleton />
        ) : (
          <>
            {/* D09 S02e: project results, only while search is switched on */}
            {q && <ProjectSearchResults query={q} onCount={setProjectCount} />}

            <Tabs defaultValue="all" className="w-full cd-stack">
              <TabsList className="mx-auto grid w-full max-w-md grid-cols-4 h-auto">
                {[["all", "All"], ["categories", "Categories"], ["tags", "Tags"], ["users", "Users"]].map(([v, label]) => (
                  <TabsTrigger key={v} value={v} className="cursor-pointer min-h-11">
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* All Results Tab: people, then tags, then categories */}
              <TabsContent value="all" className="cd-stack">
                {userCount > 0 && (
                  <Group id="all-users" icon={<Users className="h-5 w-5" />} title="Users" count={userCount}>
                    {userGrid([...activeUsers, ...inactiveUsers])}
                  </Group>
                )}
                {filteredTags.length > 0 && (
                  <Group id="all-tags" icon={<Hash className="h-5 w-5" />} title="Tags" count={filteredTags.length}>
                    {tagList}
                  </Group>
                )}
                {filteredCategories.length > 0 && (
                  <Group id="all-categories" icon={<Folder className="h-5 w-5" />} title="Categories" count={filteredCategories.length}>
                    {categoryGrid}
                  </Group>
                )}
                {q && totalResults === 0 && (
                  <div className="cd-empty">
                    <Search className="h-12 w-12 cd-muted" aria-hidden="true" />
                    <h2 className="cd-subheading">No results found</h2>
                    <p className="cd-muted">Try searching with different keywords</p>
                  </div>
                )}
              </TabsContent>

              {/* Categories Only Tab */}
              <TabsContent value="categories" className="cd-stack">
                <div className="cd-stack-tight">
                  <h2 className="cd-heading">All Categories</h2>
                  <p className="cd-muted">Explore projects organized by category - from web applications to AI/ML and beyond</p>
                </div>
                {filteredCategories.length > 0 ? (
                  <Group id="tab-categories" icon={<Folder className="h-5 w-5" />} title="Categories" count={filteredCategories.length}>
                    {categoryGrid}
                  </Group>
                ) : (
                  <p className="cd-empty cd-muted">No categories found</p>
                )}
              </TabsContent>

              {/* Tags Only Tab */}
              <TabsContent value="tags" className="cd-stack">
                <div className="cd-stack-tight">
                  <h2 className="cd-heading">Browse All Tags</h2>
                  <p className="cd-muted">Discover projects by technology stack and features</p>
                </div>
                {filteredTags.length > 0 ? (
                  <Group id="tab-tags" icon={<Hash className="h-5 w-5" />} title="Tags" count={filteredTags.length}>
                    {tagList}
                  </Group>
                ) : (
                  <p className="cd-empty cd-muted">No tags found</p>
                )}
              </TabsContent>

              {/* Users Only Tab: top three, honorable mentions, then people with no projects */}
              <TabsContent value="users" className="cd-stack">
                <div className="cd-stack-tight">
                  <h2 className="cd-heading">All Contributing Users</h2>
                  <p className="cd-muted">Browse and discover all the amazing contributors to our projects</p>
                </div>
                {userCount > 0 ? (
                  <Group id="tab-users" icon={<Users className="h-5 w-5" />} title="Users" count={userCount}>
                    {activeUsers.length > 0 && (
                      <div className="cd-stack-tight">
                        <h3 className="cd-subheading">Top Contributors</h3>
                        {userGrid(activeUsers.slice(0, 3), true)}
                      </div>
                    )}
                    {activeUsers.length > 3 && (
                      <div className="cd-stack-tight">
                        <h3 className="cd-subheading">⭐️ Honorable Mentions ⭐️</h3>
                        {userGrid(activeUsers.slice(3))}
                      </div>
                    )}
                    {inactiveUsers.length > 0 && (
                      <div className="cd-stack-tight">
                        <h3 className="cd-subheading">Inactive Users (showing {totalInactiveCount} total)</h3>
                        {userGrid(inactiveUsers)}
                      </div>
                    )}
                  </Group>
                ) : (
                  <p className="cd-empty cd-muted">No users found</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  // D07x/D08g4e3: the app's login (Better Auth).
  const viewer = usePersonalPageViewer();

  return (
    <ProjectsProvider userId={viewer.userId}>
      <AppShell>
        <SearchContent signedIn={!!viewer.userId} />
      </AppShell>
    </ProjectsProvider>
  );
}
