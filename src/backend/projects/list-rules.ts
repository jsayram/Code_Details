// D07x: how the project lists sort and page, shared by the personal lists
// (personal.ts, D02r-c) and the public list query (convex/projects.ts
// listPublic), so the two can't drift apart. Pure: no Convex, Next or
// database imports, because the Convex functions import it too.
//
// The sorts are the ones /api/projects offers on Supabase, with the same keys
// and directions. Supabase has no tie-breaker; here ties go newest first, then
// by id, so a page is stable. "trending" has no 7-day window yet, so it sorts
// as popular (D02r-c carry-forward, D09).

export const LIST_SORTS = [
  "newest",
  "oldest",
  "recently-edited",
  "popular",
  "alphabetical",
  "alphabetical-desc",
  "most-tagged",
  "least-favorited",
  "trending",
  "random",
] as const;

/** What a sort reads from a row. Times are epoch milliseconds. */
export interface SortFields {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  favoriteCount: number;
  tagCount: number;
}

const titleKey = (title: string) => title.normalize("NFKC").toLowerCase();
const byTitle = (a: SortFields, b: SortFields) => {
  const x = titleKey(a.title);
  const y = titleKey(b.title);
  return x < y ? -1 : x > y ? 1 : 0;
};
const newest = (a: SortFields, b: SortFields) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const COMPARE: Record<string, (a: SortFields, b: SortFields) => number> = {
  newest,
  oldest: (a, b) => -newest(a, b),
  "recently-edited": (a, b) => b.updatedAt - a.updatedAt || newest(a, b),
  popular: (a, b) => b.favoriteCount - a.favoriteCount || newest(a, b),
  trending: (a, b) => b.favoriteCount - a.favoriteCount || newest(a, b),
  "least-favorited": (a, b) => a.favoriteCount - b.favoriteCount || newest(a, b),
  alphabetical: (a, b) => byTitle(a, b) || newest(a, b),
  "alphabetical-desc": (a, b) => byTitle(b, a) || newest(a, b),
  "most-tagged": (a, b) => b.tagCount - a.tagCount || newest(a, b),
};

/** A sorted copy. Unknown sorts fall back to newest, as the Supabase route does. */
export function sortRows<T>(rows: readonly T[], sortBy: string, fields: (row: T) => SortFields, random: () => number = Math.random): T[] {
  const out = [...rows];
  if (sortBy === "random") {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const compare = COMPARE[sortBy] ?? newest;
  return out.sort((a, b) => compare(fields(a), fields(b)));
}

/** One page of already sorted rows. A limit of 0 means every row, as on Supabase. */
export function pageRows<T>(rows: readonly T[], page: number, limit: number): { rows: T[]; total: number; totalPages: number } {
  const total = rows.length;
  if (limit <= 0) return { rows: [...rows], total, totalPages: 1 };
  const start = (Math.max(1, page) - 1) * limit;
  return { rows: rows.slice(start, start + limit), total, totalPages: Math.ceil(total / limit) };
}
