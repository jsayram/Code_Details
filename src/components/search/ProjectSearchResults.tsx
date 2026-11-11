"use client";

// D09 S02e: project results on /search, from GET /api/search. Renders nothing
// unless that route answers (on by default; CODEDETAILS_SEARCH=off), so the page is unchanged
// while the switch is off. Results come from the server in relevance order;
// text is rendered as plain text (React escapes it), never as HTML.
//
// D10: a settled search (the query unchanged for about a second) is asked once
// more with final=1, so it counts as a search and not as typing (S00.3 §7);
// when the response carries a receipt, "results shown" and clicks are sent to
// /api/search/events. Analytics failures are ignored.
//
// UI07.1: drawn with the foundations (the page carries the scope). Results
// are link tiles; the category shows its label in its own color.
//
// S04-URL: a category filter (the shared CategorySelect, labelled and
// keyboard-usable). The page owns the value and keeps it in the address; the
// results come from /api/search with category=, which refuses unknown keys.
// /api/search/facets for the same query, without the category, says which
// categories have matches: the others stay listed but disabled, as on the
// project lists. If the facets don't load, every category stays selectable.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROJECT_CATEGORIES, type ProjectCategory } from "@/constants/project-categories";
import { CategorySelect } from "@/components/filters/CategorySelect";
import { HighlightText } from "@/components/HighlightText";
import { visitToken } from "./visit-token";

type Hit = {
  entityId: string;
  route: string;
  title: string;
  description: string | null;
  category: string;
  tags: { id: string; name: string }[];
  owner: { username: string; fullName: string | null } | null;
  favoriteCount: number;
};
type Page = {
  hits: Hit[];
  nextCursor: string | null;
  total: { value: number; relation: "eq" | "gte" } | null;
  receipt: { id: string } | null;
  applied: { correctedQuery?: string };
};

/** Extra wait after the page's own debounce before a search counts as settled. */
const SETTLE_MS = 600;
const PAGE_SIZE = 12;

async function fetchPage(q: string, opts: { category?: string; cursor?: string | null; final?: boolean; signal?: AbortSignal }): Promise<Page | "off" | "error"> {
  const params = new URLSearchParams({ q, pageSize: String(PAGE_SIZE) });
  if (opts.category) params.set("category", opts.category);
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.final) params.set("final", "1");
  const visit = visitToken();
  try {
    const res = await fetch(`/api/search?${params}`, { signal: opts.signal, headers: visit ? { "x-search-visit": visit } : {} });
    if (res.status === 404) return "off";
    if (!res.ok) return "error";
    return ((await res.json()) as { data: Page }).data;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return "error";
  }
}

/** Matches per category for the query, or null when the facets didn't load. */
async function fetchCategoryFacets(q: string, signal: AbortSignal): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`/api/search/facets?${new URLSearchParams({ q })}`, { signal });
    if (!res.ok) return null;
    const category = ((await res.json()) as { data?: { category?: unknown } }).data?.category;
    return category && typeof category === "object" ? (category as Record<string, number>) : null;
  } catch {
    return null;
  }
}

function sendEvents(events: Record<string, unknown>[]) {
  const visit = visitToken();
  if (!visit || events.length === 0) return;
  void fetch("/api/search/events", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json", "x-search-visit": visit },
    body: JSON.stringify({ events }),
  }).catch(() => undefined);
}

const eventId = () => `ev-${crypto.randomUUID()}`;

/**
 * onCount: how many projects are shown now (0 while off, loading or failed), for the page's summary.
 * category / onCategoryChange: the category filter, owned by the page.
 */
export function ProjectSearchResults({
  query,
  onCount,
  category,
  onCategoryChange,
}: {
  query: string;
  onCount?: (n: number) => void;
  category?: ProjectCategory;
  onCategoryChange?: (category: ProjectCategory | undefined) => void;
}) {
  const q = query.trim();
  const [facets, setFacets] = useState<Record<string, number> | null>(null);
  const [state, setState] = useState<"off" | "idle" | "loading" | "ready" | "error">("idle");
  const [hits, setHits] = useState<Hit[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const receipt = useRef<string | null>(null);
  // Nothing is shown until the route has answered once, so a switched-off
  // search never flashes a loading card.
  const [known, setKnown] = useState(false);

  useEffect(() => {
    if (!q || state === "off") return;
    const controller = new AbortController();
    receipt.current = null;
    setState("loading");
    let settle: ReturnType<typeof setTimeout> | undefined;
    fetchPage(q, { category, signal: controller.signal })
      .then((r) => {
        if (r === "off") return setState("off");
        setKnown(true);
        if (r === "error") return setState("error");
        setPage(r);
        setHits(r.hits);
        setState("ready");
        settle = setTimeout(async () => {
          const settled = await fetchPage(q, { category, final: true, signal: controller.signal }).catch(() => "error" as const);
          if (typeof settled === "string" || !settled.receipt) return;
          receipt.current = settled.receipt.id;
          sendEvents([{ type: "results_presented", eventId: eventId(), receiptId: settled.receipt.id, positions: settled.hits.map((_, i) => i) }]);
        }, SETTLE_MS);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      clearTimeout(settle);
    };
    // state is read only to stop asking once the route says search is off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category]);

  // Which categories have matches for this query: asked once per query, only
  // after the search route has answered (so never while search is off).
  useEffect(() => {
    if (!q || !known || state === "off" || !onCategoryChange) return;
    const controller = new AbortController();
    setFacets(null);
    void fetchCategoryFacets(q, controller.signal).then((f) => {
      if (!controller.signal.aborted) setFacets(f);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, known]);

  const loadMore = useCallback(async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    const r = await fetchPage(q, { category, cursor: page.nextCursor }).catch(() => "error" as const);
    setLoadingMore(false);
    if (typeof r === "string") return;
    setPage(r);
    setHits((prev) => {
      const seen = new Set(prev.map((h) => h.entityId));
      return [...prev, ...r.hits.filter((h) => !seen.has(h.entityId))];
    });
  }, [page, q, category]);

  const shown = q && known && state === "ready" ? hits.length : 0;
  useEffect(() => {
    onCount?.(shown);
  }, [shown, onCount]);
  // Unmounted when the query is cleared: the page's count goes back to 0.
  useEffect(() => () => onCount?.(0), [onCount]);

  const onOpen = (hit: Hit, position: number) => {
    if (receipt.current && position < PAGE_SIZE) {
      sendEvents([{ type: "result_clicked", eventId: eventId(), receiptId: receipt.current, entityId: hit.entityId, position }]);
    }
  };

  if (!q || !known || state === "off" || state === "idle") return null;

  const count = page?.total
    ? page.total.relation === "gte" ? "1,000+" : String(page.total.value)
    : `${hits.length}${page?.nextCursor ? "+" : ""}`;

  return (
    <section className="cd-surface cd-stack" aria-labelledby="project-results-title" data-testid="project-search-results">
      <div className="cd-stack-tight">
        <h2 id="project-results-title" className="cd-heading flex items-center gap-2">
          <FolderSearch className="h-5 w-5" aria-hidden="true" />
          Projects
          {state === "ready" && <span className="cd-status cd-number" data-tone="selected">{count}</span>}
        </h2>
        {page?.applied.correctedQuery && state === "ready" && (
          <p className="cd-small cd-muted">Showing results for “{page.applied.correctedQuery}”</p>
        )}
      </div>
      {onCategoryChange && (
        <div className="cd-filter-bar" style={{ justifyContent: "flex-start" }}>
          <CategorySelect
            value={category ?? "all"}
            onValueChange={(v) => onCategoryChange(v === "all" ? undefined : v)}
            hasCategoryProjects={facets ? (key) => (facets[key] ?? 0) > 0 || key === category : undefined}
            triggerClassName="w-full sm:w-[240px]"
          />
        </div>
      )}
      {state === "loading" && (
        <p className="cd-small cd-muted flex items-center gap-2" role="status">
          <span aria-hidden="true" className="cd-spinner animate-spin" />
          Searching projects…
        </p>
      )}
      {state === "error" && <p className="cd-small cd-muted" role="status">Project search is unavailable right now.</p>}
      {state === "ready" && hits.length === 0 && (
        <p className="cd-small cd-muted">
          {category ? `No projects in ${PROJECT_CATEGORIES[category]?.label ?? category} match “${q}”.` : `No projects match “${q}”.`}
        </p>
      )}
      {state === "ready" && hits.length > 0 && (
        <ul className="cd-grid">
          {hits.map((hit, i) => (
            <li key={hit.entityId} className="min-w-0">
              <Link href={hit.route} onClick={() => onOpen(hit, i)} className="cd-tile">
                <h3 className="cd-subheading cd-wrap"><HighlightText text={hit.title} highlight={q} /></h3>
                {hit.owner && <p className="cd-small cd-muted cd-wrap">by {hit.owner.fullName ?? hit.owner.username}</p>}
                {hit.description && (
                  <p className="cd-small cd-muted line-clamp-2 cd-wrap"><HighlightText text={hit.description} highlight={q} /></p>
                )}
                <div className="cd-cluster" style={{ gap: "var(--cd-space-2)" }}>
                  <span className="cd-status cd-cat" data-category={hit.category}>
                    {PROJECT_CATEGORIES[hit.category as keyof typeof PROJECT_CATEGORIES]?.label ?? hit.category}
                  </span>
                  {hit.tags.slice(0, 4).map((t) => (
                    <span key={t.id} className="cd-tag cd-wrap">{t.name}</span>
                  ))}
                  {hit.favoriteCount > 0 && (
                    <span className="cd-small cd-muted cd-number">
                      <span aria-hidden="true">⭐</span> {hit.favoriteCount}<span className="sr-only"> favorites</span>
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state === "ready" && page?.nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show more projects"}
          </Button>
        </div>
      )}
    </section>
  );
}
