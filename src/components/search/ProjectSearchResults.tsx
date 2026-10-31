"use client";

// D09 S02e: project results on /search, from GET /api/search. Renders nothing
// unless that route answers (CODEDETAILS_SEARCH=on), so the page is unchanged
// while the switch is off. Results come from the server in relevance order;
// text is rendered as plain text (React escapes it), never as HTML.
//
// D10: a settled search (the query unchanged for about a second) is asked once
// more with final=1, so it counts as a search and not as typing (S00.3 §7);
// when the response carries a receipt, "results shown" and clicks are sent to
// /api/search/events. Analytics failures are ignored.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

async function fetchPage(q: string, opts: { cursor?: string | null; final?: boolean; signal?: AbortSignal }): Promise<Page | "off" | "error"> {
  const params = new URLSearchParams({ q, pageSize: String(PAGE_SIZE) });
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

/** onCount: how many projects are shown now (0 while off, loading or failed), for the page's summary. */
export function ProjectSearchResults({ query, onCount }: { query: string; onCount?: (n: number) => void }) {
  const q = query.trim();
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
    fetchPage(q, { signal: controller.signal })
      .then((r) => {
        if (r === "off") return setState("off");
        setKnown(true);
        if (r === "error") return setState("error");
        setPage(r);
        setHits(r.hits);
        setState("ready");
        settle = setTimeout(async () => {
          const settled = await fetchPage(q, { final: true, signal: controller.signal }).catch(() => "error" as const);
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
  }, [q]);

  const loadMore = useCallback(async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    const r = await fetchPage(q, { cursor: page.nextCursor }).catch(() => "error" as const);
    setLoadingMore(false);
    if (typeof r === "string") return;
    setPage(r);
    setHits((prev) => {
      const seen = new Set(prev.map((h) => h.entityId));
      return [...prev, ...r.hits.filter((h) => !seen.has(h.entityId))];
    });
  }, [page, q]);

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
    <Card className="mb-6" aria-labelledby="project-results-title" data-testid="project-search-results">
      <CardHeader className="pb-3">
        <CardTitle id="project-results-title" className="flex items-center gap-2 text-lg">
          <FolderSearch className="h-5 w-5 text-primary" aria-hidden="true" />
          Projects
          {state === "ready" && <Badge variant="secondary" className="font-mono">{count}</Badge>}
        </CardTitle>
        {page?.applied.correctedQuery && state === "ready" && (
          <p className="text-sm text-muted-foreground">Showing results for “{page.applied.correctedQuery}”</p>
        )}
      </CardHeader>
      <CardContent>
        {state === "loading" && <p className="text-sm text-muted-foreground" role="status">Searching projects…</p>}
        {state === "error" && <p className="text-sm text-muted-foreground" role="status">Project search is unavailable right now.</p>}
        {state === "ready" && hits.length === 0 && (
          <p className="text-sm text-muted-foreground">No projects match “{q}”.</p>
        )}
        {state === "ready" && hits.length > 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {hits.map((hit, i) => (
              <li key={hit.entityId}>
                <Link
                  href={hit.route}
                  onClick={() => onOpen(hit, i)}
                  className="block h-full p-4 rounded-lg border transition-all hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <h3 className="font-medium"><HighlightText text={hit.title} highlight={q} /></h3>
                  {hit.owner && <p className="text-sm text-muted-foreground">by {hit.owner.fullName ?? hit.owner.username}</p>}
                  {hit.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2"><HighlightText text={hit.description} highlight={q} /></p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">{hit.category}</Badge>
                    {hit.tags.slice(0, 4).map((t) => (
                      <Badge key={t.id} variant="secondary" className="text-xs">{t.name}</Badge>
                    ))}
                    {hit.favoriteCount > 0 && <span className="text-xs text-muted-foreground">⭐ {hit.favoriteCount}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {state === "ready" && page?.nextCursor && (
          <div className="flex justify-center mt-4">
            <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Show more projects"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
