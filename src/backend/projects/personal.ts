// D02r-c: the personal lists (my projects, my graveyard, my favorites) and
// their category counts from Convex, behind the development switches. Used
// only when the project read switch is "convex" AND the login switch is
// "better-auth", both pointing at the same local backend: the Convex queries
// learn the caller from the Better Auth session (getViewer), and Clerk has no
// way to sign a Convex token. Otherwise the routes keep the Supabase read,
// which takes the user from the session too (routeViewer, D02r-a).
//
// The queries return small bounded card lists; this module filters, sorts and
// pages them the way /api/projects does on Supabase, and maps them onto the
// row shape the client already reads. Rows from here never carry an owner
// ID. user_id is "", which matches no signed-in ID, so the cards' owner
// controls (which write to Supabase with Clerk's ID) stay hidden until the
// writes move (D02/D03). Null would not do: the cards compare it with Clerk's
// userId, which is null under the Better Auth switch.
import { makeFunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";
import { viewerQuery, viewerQueryWithArgs } from "@/lib/auth-server";
import { chooseProjectReadBackend } from "./index";

export type PersonalView = "mine" | "favorites" | "deleted";

/** The card the Convex personal queries return (convex/projects.ts). */
export interface PersonalProjectCard {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  visibility: "public" | "private";
  tags: string[];
  favoriteCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  owner: { username: string; fullName: string | null; avatarUrl: string | null } | null;
  isMine: boolean;
  isFavorite: boolean;
}

const lists = {
  mine: makeFunctionReference<"query", Record<string, never>, PersonalProjectCard[]>("projects:listMine"),
  deleted: makeFunctionReference<"query", Record<string, never>, PersonalProjectCard[]>("projects:listMyDeleted"),
  favorites: makeFunctionReference<"query", Record<string, never>, PersonalProjectCard[]>("projects:listMyFavorites"),
};
const counts = makeFunctionReference<"query", { view: PersonalView }, Record<string, number>>("projects:myCategoryCounts");

/** True when the personal reads come from Convex (see the header). */
export function personalReadsFromConvex(env: Record<string, string | undefined> = process.env): boolean {
  const read = chooseProjectReadBackend(env);
  const login = chooseAuthBackend(env);
  return read.backend === "convex" && login.backend === "better-auth" && read.url === login.convexUrl;
}

export async function convexPersonalList(view: PersonalView): Promise<PersonalProjectCard[]> {
  return (await viewerQuery(lists[view]))?.result ?? [];
}

export async function convexPersonalCounts(view: PersonalView): Promise<Record<string, number>> {
  return (await viewerQueryWithArgs(counts, { view }))?.result ?? {};
}

export interface ListOptions {
  category?: string;
  tags: string[];
  sortBy: string;
  page: number;
  limit: number;
}

const byTitle = (a: PersonalProjectCard, b: PersonalProjectCard) => {
  const x = a.title.normalize("NFKC").toLowerCase();
  const y = b.title.normalize("NFKC").toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
const time = (iso: string) => Date.parse(iso);

/** The sorts /api/projects offers. "trending" has no 7-day window here yet, so it is popular. */
function sortCards(cards: PersonalProjectCard[], sortBy: string): PersonalProjectCard[] {
  const out = [...cards];
  if (sortBy === "random") {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const newest = (a: PersonalProjectCard, b: PersonalProjectCard) => time(b.createdAt) - time(a.createdAt) || (a.id < b.id ? -1 : 1);
  const compare: Record<string, (a: PersonalProjectCard, b: PersonalProjectCard) => number> = {
    oldest: (a, b) => -newest(a, b),
    "recently-edited": (a, b) => time(b.updatedAt) - time(a.updatedAt) || newest(a, b),
    popular: (a, b) => b.favoriteCount - a.favoriteCount || newest(a, b),
    trending: (a, b) => b.favoriteCount - a.favoriteCount || newest(a, b),
    "least-favorited": (a, b) => a.favoriteCount - b.favoriteCount || newest(a, b),
    alphabetical: (a, b) => byTitle(a, b) || newest(a, b),
    "alphabetical-desc": (a, b) => byTitle(b, a) || newest(a, b),
    "most-tagged": (a, b) => b.tags.length - a.tags.length || newest(a, b),
  };
  return out.sort(compare[sortBy] ?? newest);
}

/** Filter, sort and page a personal list, then map it onto /api/projects' row shape. */
export function personalListResponse(cards: PersonalProjectCard[], options: ListOptions) {
  const { category, tags, sortBy, page, limit } = options;
  const filtered = cards.filter(
    (c) => (!category || category === "all" || c.category === category) && tags.every((t) => c.tags.includes(t)),
  );
  const sorted = sortCards(filtered, sortBy);
  const total = sorted.length;
  const pageRows = limit > 0 ? sorted.slice((page - 1) * limit, page * limit) : sorted;
  const data = pageRows.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    description: c.description,
    category: c.category,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    user_id: "",
    deleted_at: c.deletedAt,
    // The Supabase column is a numeric string; the cards print it as-is.
    total_favorites: String(c.favoriteCount),
    tags: c.tags,
    profile: {
      username: c.owner?.username ?? null,
      email_address: null,
      profile_image_url: c.owner?.avatarUrl ?? null,
      full_name: c.owner?.fullName ?? null,
    },
    isFavorite: c.isFavorite,
  }));
  return {
    success: true,
    data,
    pagination: { total, page, limit: limit || total, totalPages: limit ? Math.ceil(total / limit) : 1 },
  };
}
