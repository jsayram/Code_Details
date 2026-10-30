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
import { pageRows, sortRows, type SortFields } from "./list-rules";

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

/** The filters the public list takes (D07x); never an identity. */
export type PublicListArgs = {
  category?: string;
  tags?: string[];
  /** The owner's public handle, for a portfolio. */
  handle?: string;
  sortBy: string;
  page: number;
  limit: number;
};
const publicList = makeFunctionReference<"query", PublicListArgs, { cards: PersonalProjectCard[]; total: number }>(
  "projects:listPublic",
);

/**
 * D07x: the community list and its category, tag and portfolio variants,
 * listed projects only. Asked as the request's session, so the rows know
 * which are the viewer's own and favorites; a request with no session gets
 * the same rows with both flags false. Only called under both switches.
 */
export async function convexPublicList(args: PublicListArgs): Promise<{ cards: PersonalProjectCard[]; total: number }> {
  return (await viewerQueryWithArgs(publicList, args))?.result ?? { cards: [], total: 0 };
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

const sortFields = (c: PersonalProjectCard): SortFields => ({
  id: c.id,
  title: c.title,
  createdAt: Date.parse(c.createdAt),
  updatedAt: Date.parse(c.updatedAt),
  favoriteCount: c.favoriteCount,
  tagCount: c.tags.length,
});

/** Filter, sort and page a personal list, then map it onto /api/projects' row shape. */
export function personalListResponse(cards: PersonalProjectCard[], options: ListOptions) {
  const { category, tags, sortBy, page, limit } = options;
  const filtered = cards.filter(
    (c) => (!category || category === "all" || c.category === category) && tags.every((t) => c.tags.includes(t)),
  );
  const paged = pageRows(sortRows(filtered, sortBy, sortFields), page, limit);
  return listResponse(paged.rows, paged.total, page, limit);
}

/** Cards already filtered, sorted and paged, in /api/projects' response shape. */
export function listResponse(cards: PersonalProjectCard[], total: number, page: number, limit: number) {
  const data = cards.map((c) => ({
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
    // D03: the rows carry no owner ID, so the cards' owner controls use this.
    is_mine: c.isMine,
  }));
  return {
    success: true,
    data,
    pagination: { total, page, limit: limit || total, totalPages: limit ? Math.ceil(total / limit) : 1 },
  };
}
