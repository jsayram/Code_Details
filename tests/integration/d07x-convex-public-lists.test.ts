// D07x: projects:listPublic, the community list and its category, tag and
// portfolio variants on the task-owned test backend. Listed projects only;
// the viewer comes from getViewer and only marks its own rows and favorites.
// The last block compares the answers with the Supabase route on the same
// fixtures, as D02r-b did for the personal lists.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs } from "../fixtures/convex-auth";
import { LIST_SORTS } from "@/backend/projects/list-rules";


type Card = {
  id: string;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  favoriteCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  visibility: string;
  isMine: boolean;
  isFavorite: boolean;
  owner: { username: string } | null;
};
type Args = { category?: string; tags?: string[]; handle?: string; sortBy: string; page: number; limit: number };
const listPublic = makeFunctionReference<"query", Args, { cards: Card[]; total: number }>("projects:listPublic");

const set = generateFixtures();
const { a: A, b: B, deleting, emailUsername } = set.personas;
const listedSlugs = set.projects
  .filter((p) => !p.purged && !p.deletedAt && p.visibility === "public")
  .map((p) => p.slug)
  .sort();
const slugsOf = (cards: { slug: string }[]) => cards.map((c) => c.slug).sort();
const all = (over: Partial<Args> = {}): Args => ({ sortBy: "newest", page: 1, limit: 50, ...over });

describe.skipIf(!convexAvailable())("D07x Convex public lists", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("lists every listed project, never private, deleted or purged ones, to anyone", async () => {
    const anon = await anonymousClient().query(listPublic, all());
    expect(slugsOf(anon.cards)).toEqual(listedSlugs);
    expect(anon.total).toBe(listedSlugs.length);
    for (const hidden of ["fixture-private", "fixture-deleted-recent", "fixture-deleted-long-ago", "fixture-purged"]) {
      expect(slugsOf(anon.cards)).not.toContain(hidden);
    }
    expect(anon.cards.every((c) => !c.isMine && !c.isFavorite && c.deletedAt === null && c.visibility === "public")).toBe(true);
    // Signed in, the same rows; private stays out even for its owner.
    expect(slugsOf((await clientAs(A.subject!).query(listPublic, all())).cards)).toEqual(listedSlugs);
  });

  it("marks the viewer's own rows and favorites, and nothing for a deleting account", async () => {
    const a = (await clientAs(A.subject!).query(listPublic, all())).cards;
    expect(a.filter((c) => !c.isMine).map((c) => c.slug).sort()).toEqual(["fixture-bob-project", "fixture-legacy-owner"]);
    expect(slugsOf(a.filter((c) => c.isFavorite))).toEqual(["fixture-bob-project", "fixture-listed"]);
    const b = (await clientAs(B.subject!).query(listPublic, all())).cards;
    expect(slugsOf(b.filter((c) => c.isMine))).toEqual(["fixture-bob-project"]);
    expect(slugsOf(b.filter((c) => c.isFavorite))).toEqual(["fixture-listed"]);
    const d = (await clientAs(deleting.subject!).query(listPublic, all())).cards;
    expect(d.some((c) => c.isMine || c.isFavorite)).toBe(false);
  });

  it("filters by category, tag and owner username", async () => {
    const q = (over: Partial<Args>) => anonymousClient().query(listPublic, all(over));
    expect((await q({ category: "web" })).total).toBe(listedSlugs.length);
    expect((await q({ category: "all" })).total).toBe(listedSlugs.length);
    expect((await q({ category: "game" })).cards).toEqual([]);
    const tagged = (...names: string[]) =>
      set.projects
        .filter((p) => listedSlugs.includes(p.slug) && names.every((n) => p.tagIds.includes(set.tags.find((t) => t.name === n)!.id)))
        .map((p) => p.slug)
        .sort();
    expect(slugsOf((await q({ tags: ["Rust"] })).cards)).toEqual(tagged("Rust"));
    expect(slugsOf((await q({ tags: ["Next.js", "Postgres"] })).cards)).toEqual(tagged("Next.js", "Postgres"));
    expect((await q({ tags: ["No Such Tag"] })).cards).toEqual([]);
    expect(slugsOf((await q({ handle: B.profile!.username })).cards)).toEqual(["fixture-bob-project"]);
    expect(slugsOf((await q({ handle: B.profile!.username.toUpperCase() })).cards)).toEqual(["fixture-bob-project"]);
    expect((await q({ handle: "fixture-nobody" })).cards).toEqual([]);
    // The email-shaped legacy username was replaced on import (fix-email-username);
    // the portfolio answers to the handle the cards show.
    const legacy = (await q({})).cards.find((c) => c.slug === "fixture-legacy-owner")!;
    expect(slugsOf((await q({ handle: legacy.owner!.username })).cards)).toEqual(["fixture-legacy-owner"]);
    // A deleting account's portfolio is not public (P07 §8).
    expect((await q({ handle: deleting.profile!.username })).cards).toEqual([]);
  });

  it("pages are stable and add up to the whole list", async () => {
    for (const sortBy of LIST_SORTS.filter((s) => s !== "random")) {
      const whole = (await anonymousClient().query(listPublic, all({ sortBy }))).cards.map((c) => c.slug);
      const paged: string[] = [];
      for (let page = 1; page <= Math.ceil(whole.length / 3); page++) {
        const res = await anonymousClient().query(listPublic, all({ sortBy, page, limit: 3 }));
        expect(res.total).toBe(whole.length);
        paged.push(...res.cards.map((c) => c.slug));
      }
      expect(paged, sortBy).toEqual(whole);
    }
  });

  it("caps the page size and clamps nonsense paging", async () => {
    const res = await anonymousClient().query(listPublic, all({ limit: 10_000, page: -4 }));
    expect(res.cards.length).toBe(listedSlugs.length);
    expect((await anonymousClient().query(listPublic, all({ page: 99 }))).cards).toEqual([]);
  });

  it("rows carry no email, provider subject, role, tier or owner ID", async () => {
    const text = JSON.stringify(await clientAs(A.subject!).query(listPublic, all()));
    for (const secret of [A.profile!.email, B.profile!.email, emailUsername.profile!.email, A.subject!, B.subject!, '"role"', '"tier"', "ownerId", "userId"]) {
      expect(text).not.toContain(secret);
    }
  });

  // E03: the parity check against the Supabase route went with that route.
  // tests/integration/d09-public-access.test.ts calls the Convex routes over HTTP.
});
