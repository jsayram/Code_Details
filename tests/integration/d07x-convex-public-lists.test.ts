// D07x: projects:listPublic, the community list and its category, tag and
// portfolio variants on the task-owned test backend. Listed projects only;
// the viewer comes from getViewer and only marks its own rows and favorites.
// The last block compares the answers with the Supabase route on the same
// fixtures, as D02r-b did for the personal lists.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { LIST_SORTS } from "@/backend/projects/list-rules";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

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

describe.skipIf(!convexAvailable() || !testIssuerAvailable())("D07x Convex public lists", () => {
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

  describe.skipIf(!testDbAvailable())("compared with the Supabase route", () => {
    let sql: postgres.Sql;
    let projectsRoute: typeof import("../../src/app/api/projects/route.js");

    beforeAll(async () => {
      sql = await connectTestDb();
      await cleanupFixtures(sql);
      await loadFixtures(sql, set);
      projectsRoute = await import("../../src/app/api/projects/route.js");
    });
    afterAll(async () => {
      signInAs(null);
      await cleanupFixtures(sql);
      await sql.end();
    });

    type Row = { slug: string; title: string; tags: string[]; total_favorites: string; created_at: string; updated_at: string; isFavorite: boolean; profile: { username: string | null } };
    // Supabase has no visibility column, so its "private" fixture is an
    // ordinary listed project there; it is left out of the comparison.
    const supabaseRows = async (query: string) => {
      const res = await projectsRoute.GET(new NextRequest(`http://localhost:3100/api/projects?showAll=true&limit=50&${query}`));
      const body = JSON.parse(await res.text()) as { data: Row[] };
      if (!body.data) throw new Error(`${query}: ${res.status} ${JSON.stringify(body)}`);
      return body.data.filter((r) => r.slug !== "fixture-private");
    };
    const same = (r: { slug: string; tags: string[]; favorites: number; isFavorite: boolean; username: string | null }) => ({ ...r, tags: [...r.tags].sort() });
    // The one known difference: the email-shaped legacy username shows its
    // local part on Supabase (D04a) and was replaced by a generated handle on
    // import (fix-email-username), so that owner is left out of the comparison.
    const owner = (slug: string, username: string | null) => (slug === "fixture-legacy-owner" ? "(renamed on import)" : username);
    const fromCard = (c: Card) => same({ slug: c.slug, tags: c.tags, favorites: c.favoriteCount, isFavorite: c.isFavorite, username: owner(c.slug, c.owner?.username ?? null) });
    const fromRow = (r: Row) => same({ slug: r.slug, tags: r.tags, favorites: Number(r.total_favorites), isFavorite: r.isFavorite, username: owner(r.slug, r.profile.username) });
    const bySlug = <T extends { slug: string }>(rows: T[]) => [...rows].sort((x, y) => x.slug.localeCompare(y.slug));

    // What each sort orders by, read from both shapes; Supabase breaks ties
    // arbitrarily, so the sequence of keys is compared, not the slugs.
    const key: Record<string, { card: (c: Card) => unknown; row: (r: Row) => unknown }> = {
      newest: { card: (c) => Date.parse(c.createdAt), row: (r) => Date.parse(r.created_at) },
      oldest: { card: (c) => Date.parse(c.createdAt), row: (r) => Date.parse(r.created_at) },
      "recently-edited": { card: (c) => Date.parse(c.updatedAt), row: (r) => Date.parse(r.updated_at) },
      popular: { card: (c) => c.favoriteCount, row: (r) => Number(r.total_favorites) },
      "least-favorited": { card: (c) => c.favoriteCount, row: (r) => Number(r.total_favorites) },
      alphabetical: { card: (c) => c.title.toLowerCase(), row: (r) => r.title.toLowerCase() },
      "alphabetical-desc": { card: (c) => c.title.toLowerCase(), row: (r) => r.title.toLowerCase() },
      "most-tagged": { card: (c) => c.tags.length, row: (r) => r.tags.length },
    };

    for (const persona of [null, A, B]) {
      it(`${persona ? `persona ${persona.key}` : "anonymous"}: same rows, tags, counts, owners and flags for each filter`, async () => {
        signInAs(persona?.subject ?? null);
        const client = persona ? clientAs(persona.subject!) : anonymousClient();
        const cases: [Partial<Args>, string][] = [
          [{}, ""],
          [{ category: "web" }, "category=web"],
          [{ tags: ["Rust"] }, "tags=Rust"],
          [{ tags: ["Next.js", "No Such Tag"] }, "tags=Next.js&tags=No%20Such%20Tag"],
          [{ tags: ["No Such Tag"] }, "tags=No%20Such%20Tag"],
          [{ handle: A.profile!.username }, `username=${A.profile!.username}`],
          [{ handle: "fixture-nobody" }, "username=fixture-nobody"],
        ];
        // Two or more matching tags are left out: the Supabase route's
        // sql.join has no separator and that query fails with a 500 (a
        // default-path defect logged in WORK_LEDGER, D07x). The Convex answer
        // for them is checked against the fixtures above.
        for (const [args, query] of cases) {
          const convex = (await client.query(listPublic, all(args))).cards.filter((c) => c.slug !== "fixture-private");
          expect(bySlug(convex.map(fromCard)), query || "community").toEqual(bySlug((await supabaseRows(query)).map(fromRow)));
        }
      });
    }

    for (const sortBy of Object.keys(key)) {
      it(`sort ${sortBy} orders by the same key as Supabase`, async () => {
        signInAs(null);
        const convex = (await anonymousClient().query(listPublic, all({ sortBy }))).cards;
        const supabase = await supabaseRows(`sortBy=${sortBy}`);
        expect(convex.map(key[sortBy].card)).toEqual(supabase.map(key[sortBy].row));
      });
    }
  });
});
