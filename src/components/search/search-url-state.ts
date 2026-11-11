// S04-URL: what /search keeps in its address: the query (q), the active tab
// (tab) and the project category filter (category). Pure, so the page and the
// unit tests share it.
//
// Every value is checked on the way in. The query is cut to the search API's
// own length limit (never in the middle of a character), the tab must be one
// of the page's tabs and the category one of the known category keys;
// anything else falls back to the default. The tab and the category only mean
// something next to a query, so without one they are dropped, the same way
// the page resets the tab when the query is cleared. Defaults are left out of
// the address, and parameters this page doesn't own are kept as they are.
// Nothing here is ever rendered as HTML: the values go to React as text.
import { MAX_QUERY_LENGTH } from "@/backend/search/search-rules";
import { PROJECT_CATEGORIES, type ProjectCategory } from "@/constants/project-categories";

export const SEARCH_TABS = ["all", "categories", "tags", "users"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export interface SearchUrlState {
  q: string;
  tab: SearchTab;
  category?: ProjectCategory;
}

/** The query cut to the API's limit, without splitting a surrogate pair. */
export function clampQuery(q: string): string {
  if (q.length <= MAX_QUERY_LENGTH) return q;
  let out = "";
  for (const ch of q) {
    if (out.length + ch.length > MAX_QUERY_LENGTH) break;
    out += ch;
  }
  return out;
}

export function parseTab(value: string | null | undefined): SearchTab {
  return (SEARCH_TABS as readonly string[]).includes(value ?? "") ? (value as SearchTab) : "all";
}

export function parseCategory(value: string | null | undefined): ProjectCategory | undefined {
  return value && Object.hasOwn(PROJECT_CATEGORIES, value) ? (value as ProjectCategory) : undefined;
}

type Readable = Pick<URLSearchParams, "get">;

/** The page's state from an address's parameters, every value checked. */
export function parseSearchUrl(params: Readable): SearchUrlState {
  const q = clampQuery(params.get("q") ?? "");
  if (!q.trim()) return { q: "", tab: "all" };
  const category = parseCategory(params.get("category"));
  return { q, tab: parseTab(params.get("tab")), ...(category ? { category } : {}) };
}

/**
 * The query string (without "?") for this state: q, tab and category set or
 * removed, other parameters kept. Values are checked again, so whatever the
 * caller holds, the address only carries valid ones.
 */
export function searchUrlString(state: SearchUrlState, current: string | URLSearchParams = ""): string {
  const params = new URLSearchParams(current);
  const q = clampQuery(state.q);
  const hasQuery = Boolean(q.trim());
  const tab = hasQuery ? parseTab(state.tab) : "all";
  const category = hasQuery ? parseCategory(state.category) : undefined;
  if (hasQuery) params.set("q", q);
  else params.delete("q");
  if (tab !== "all") params.set("tab", tab);
  else params.delete("tab");
  if (category) params.set("category", category);
  else params.delete("category");
  return params.toString();
}
