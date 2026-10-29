// D02r-c: when the personal reads come from Convex, and how the Convex cards
// become /api/projects rows (filter, sort, page, row shape).
import { describe, expect, it } from "vitest";
import { type PersonalProjectCard, personalListResponse, personalReadsFromConvex } from "@/backend/projects/personal";

const both = {
  NODE_ENV: "development",
  CODEDETAILS_PROJECT_READ_BACKEND: "convex",
  CODEDETAILS_AUTH_BACKEND: "better-auth",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
};

describe("personalReadsFromConvex", () => {
  it("needs the Convex read and Better Auth together, in development", () => {
    expect(personalReadsFromConvex(both)).toBe(true);
    expect(personalReadsFromConvex({})).toBe(false);
    expect(personalReadsFromConvex({ ...both, CODEDETAILS_PROJECT_READ_BACKEND: undefined })).toBe(false);
    expect(personalReadsFromConvex({ ...both, CODEDETAILS_AUTH_BACKEND: undefined })).toBe(false);
    expect(personalReadsFromConvex({ ...both, NODE_ENV: "production" })).toBe(false);
    expect(personalReadsFromConvex({ ...both, CODEDETAILS_CONVEX_URL: "https://x.convex.cloud" })).toBe(false);
  });
});

const card = (over: Partial<PersonalProjectCard>): PersonalProjectCard => ({
  id: "k1",
  slug: "s",
  title: "T",
  description: null,
  category: "web",
  visibility: "public",
  tags: [],
  favoriteCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  owner: { username: "fixture-alice", fullName: "Alice Fixture", avatarUrl: null },
  isMine: true,
  isFavorite: false,
  ...over,
});

const cards = [
  card({ id: "a", slug: "a", title: "beta", category: "web", tags: ["Rust"], favoriteCount: 1, createdAt: "2026-01-03T00:00:00.000Z" }),
  card({ id: "b", slug: "b", title: "Alpha", category: "mobile", tags: ["Rust", "Go"], favoriteCount: 3, createdAt: "2026-01-01T00:00:00.000Z" }),
  card({ id: "c", slug: "c", title: "Émile", category: "web", tags: [], favoriteCount: 2, createdAt: "2026-01-02T00:00:00.000Z", isFavorite: true }),
];
const opts = { tags: [] as string[], sortBy: "newest", page: 1, limit: 0 };
const order = (r: ReturnType<typeof personalListResponse>) => r.data.map((d) => d.slug);

describe("personalListResponse", () => {
  it("sorts like /api/projects", () => {
    expect(order(personalListResponse(cards, opts))).toEqual(["a", "c", "b"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "oldest" }))).toEqual(["b", "c", "a"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "popular" }))).toEqual(["b", "c", "a"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "least-favorited" }))).toEqual(["a", "c", "b"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "alphabetical" }))).toEqual(["b", "a", "c"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "alphabetical-desc" }))).toEqual(["c", "a", "b"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "most-tagged" }))).toEqual(["b", "a", "c"]);
    expect(order(personalListResponse(cards, { ...opts, sortBy: "random" })).sort()).toEqual(["a", "b", "c"]);
  });

  it("filters by category and by all of the tags", () => {
    expect(order(personalListResponse(cards, { ...opts, category: "web" }))).toEqual(["a", "c"]);
    expect(order(personalListResponse(cards, { ...opts, category: "all" }))).toHaveLength(3);
    expect(order(personalListResponse(cards, { ...opts, tags: ["Rust"] }))).toEqual(["a", "b"]);
    expect(order(personalListResponse(cards, { ...opts, tags: ["Rust", "Go"] }))).toEqual(["b"]);
    expect(order(personalListResponse(cards, { ...opts, tags: ["Nope"] }))).toEqual([]);
  });

  it("pages with the same pagination fields", () => {
    const r = personalListResponse(cards, { ...opts, page: 2, limit: 2 });
    expect(order(r)).toEqual(["b"]);
    expect(r.pagination).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
    expect(personalListResponse(cards, opts).pagination).toEqual({ total: 3, page: 1, limit: 3, totalPages: 1 });
  });

  it("maps onto the row shape with no owner ID or email", () => {
    const [row] = personalListResponse([cards[2]], opts).data;
    expect(row).toEqual({
      id: "c",
      title: "Émile",
      slug: "c",
      description: null,
      category: "web",
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      user_id: "",
      deleted_at: null,
      total_favorites: "2",
      tags: [],
      profile: { username: "fixture-alice", email_address: null, profile_image_url: null, full_name: "Alice Fixture" },
      isFavorite: true,
    });
  });
});
