// D07x: the sort and page rules the personal and public lists share
// (src/backend/projects/list-rules.ts), and the row shape of a public page.
import { describe, expect, it } from "vitest";
import { LIST_SORTS, pageRows, sortRows, type SortFields } from "@/backend/projects/list-rules";
import { type PersonalProjectCard, listResponse } from "@/backend/projects/personal";
import { projectQuerySchema } from "@/types/schemas/project";

const row = (id: string, over: Partial<SortFields> = {}): SortFields => ({
  id,
  title: id,
  createdAt: 1000,
  updatedAt: 1000,
  favoriteCount: 0,
  tagCount: 0,
  ...over,
});
const ids = (rows: SortFields[]) => rows.map((r) => r.id);
const sort = (rows: SortFields[], by: string) => ids(sortRows(rows, by, (r) => r));

describe("sortRows", () => {
  const rows = [
    row("a", { title: "banana", createdAt: 3, updatedAt: 5, favoriteCount: 2, tagCount: 1 }),
    row("b", { title: "Apple", createdAt: 1, updatedAt: 9, favoriteCount: 7, tagCount: 4 }),
    row("c", { title: "cherry", createdAt: 2, updatedAt: 1, favoriteCount: 0, tagCount: 2 }),
  ];

  it("offers exactly the sorts /api/projects validates", () => {
    expect([...LIST_SORTS].sort()).toEqual([...projectQuerySchema.shape.sortBy.removeDefault().options].sort());
  });

  it("orders by each key in the Supabase direction", () => {
    expect(sort(rows, "newest")).toEqual(["a", "c", "b"]);
    expect(sort(rows, "oldest")).toEqual(["b", "c", "a"]);
    expect(sort(rows, "recently-edited")).toEqual(["b", "a", "c"]);
    expect(sort(rows, "popular")).toEqual(["b", "a", "c"]);
    expect(sort(rows, "trending")).toEqual(["b", "a", "c"]);
    expect(sort(rows, "least-favorited")).toEqual(["c", "a", "b"]);
    expect(sort(rows, "alphabetical")).toEqual(["b", "a", "c"]);
    expect(sort(rows, "alphabetical-desc")).toEqual(["c", "a", "b"]);
    expect(sort(rows, "most-tagged")).toEqual(["b", "c", "a"]);
  });

  it("breaks ties newest first, then by id, so pages are stable", () => {
    const tied = [row("z", { createdAt: 1 }), row("y", { createdAt: 2 }), row("x", { createdAt: 1 })];
    expect(sort(tied, "popular")).toEqual(["y", "x", "z"]);
  });

  it("falls back to newest for an unknown sort and shuffles for random", () => {
    expect(sort(rows, "everything")).toEqual(["a", "c", "b"]);
    const shuffled = sortRows(rows, "random", (r) => r, () => 0);
    expect(ids(shuffled).sort()).toEqual(["a", "b", "c"]);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
  });
});

describe("pageRows", () => {
  const rows = Array.from({ length: 7 }, (_, i) => i);
  it("slices a page and reports the total", () => {
    expect(pageRows(rows, 2, 3)).toEqual({ rows: [3, 4, 5], total: 7, totalPages: 3 });
    expect(pageRows(rows, 4, 3)).toEqual({ rows: [], total: 7, totalPages: 3 });
    expect(pageRows(rows, 0, 3).rows).toEqual([0, 1, 2]);
  });
  it("returns every row for a limit of 0", () => {
    expect(pageRows(rows, 1, 0)).toEqual({ rows, total: 7, totalPages: 1 });
  });
});

describe("listResponse", () => {
  const card: PersonalProjectCard = {
    id: "k1",
    slug: "s",
    title: "T",
    description: null,
    category: "web",
    visibility: "public",
    tags: ["Go"],
    favoriteCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: null,
    owner: { username: "fixture-bob", fullName: null, avatarUrl: null },
    isMine: false,
    isFavorite: true,
  };

  it("maps a public page onto the Supabase row shape with no owner ID or email", () => {
    const res = listResponse([card], 31, 2, 10);
    expect(res.pagination).toEqual({ total: 31, page: 2, limit: 10, totalPages: 4 });
    expect(res.data[0]).toMatchObject({ id: "k1", user_id: "", total_favorites: "3", isFavorite: true, is_mine: false });
    expect(res.data[0].profile).toEqual({ username: "fixture-bob", email_address: null, profile_image_url: null, full_name: null });
  });
});
