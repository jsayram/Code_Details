// D02r-b: the personal Convex reads (projects:listMine, listMyDeleted,
// listMyFavorites, myCategoryCounts) on the task-owned test backend. The
// caller comes only from getViewer: Clerk-era personas sign in with the D01
// synthetic issuer, and one Better Auth login is handed over to persona A the
// way D11 does it. The last block compares the answers with the Supabase
// handlers (D02r-a) on the same fixture set.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, type PersonaClient, forgetPersonaLogins } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, authState, clientWithToken, convexToken, linkPersona, signUp, syntheticEmail } from "../fixtures/better-auth";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

type Card = {
  id: string;
  slug: string;
  category: string;
  tags: string[];
  favoriteCount: number;
  deletedAt: string | null;
  visibility: string;
  isMine: boolean;
  isFavorite: boolean;
  owner: { username: string } | null;
};
type View = "mine" | "favorites" | "deleted";

const listMine = makeFunctionReference<"query", Record<string, never>, Card[]>("projects:listMine");
const listMyDeleted = makeFunctionReference<"query", Record<string, never>, Card[]>("projects:listMyDeleted");
const listMyFavorites = makeFunctionReference<"query", Record<string, never>, Card[]>("projects:listMyFavorites");
const myCategoryCounts = makeFunctionReference<"query", { view: View }, Record<string, number>>("projects:myCategoryCounts");

const set = generateFixtures();
const { a: A, b: B, admin, deleting } = set.personas;

const CARD_KEYS = [
  "category", "createdAt", "deletedAt", "description", "favoriteCount", "id", "isFavorite", "isMine",
  "owner", "slug", "tags", "title", "updatedAt", "visibility",
].sort();

const slugsOf = (cards: Card[]) => cards.map((c) => c.slug).sort();
const expectedOwn = (key: string, deleted: boolean) =>
  set.projects.filter((p) => p.ownerKey === key && !p.purged && !!p.deletedAt === deleted).map((p) => p.slug).sort();

type Client = PersonaClient;
const lists = async (c: Client) => ({
  mine: await c.query(listMine, {}),
  deleted: await c.query(listMyDeleted, {}),
  favorites: await c.query(listMyFavorites, {}),
});

describe.skipIf(!convexAvailable())("D02r-b Convex personal reads", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("my projects: A gets A's own active projects (private included), B gets B's", async () => {
    const a = await clientAs(A.subject!).query(listMine, {});
    expect(slugsOf(a)).toEqual(expectedOwn("a", false));
    expect(slugsOf(a)).toContain("fixture-private");
    expect(a.every((c) => c.isMine && c.deletedAt === null)).toBe(true);
    const b = await clientAs(B.subject!).query(listMine, {});
    expect(slugsOf(b)).toEqual(["fixture-bob-project"]);
  });

  it("graveyard: only the caller's own deleted projects", async () => {
    const a = await clientAs(A.subject!).query(listMyDeleted, {});
    expect(slugsOf(a)).toEqual(["fixture-deleted-long-ago", "fixture-deleted-recent"]);
    expect(a.every((c) => c.isMine && c.deletedAt !== null)).toBe(true);
    expect(await clientAs(B.subject!).query(listMyDeleted, {})).toEqual([]);
  });

  it("favorites: the caller's own rows only, without deleted projects", async () => {
    const a = await clientAs(A.subject!).query(listMyFavorites, {});
    expect(slugsOf(a)).toEqual(["fixture-bob-project", "fixture-listed"]);
    expect(a.every((c) => c.isFavorite)).toBe(true);
    expect(a.find((c) => c.slug === "fixture-listed")?.isMine).toBe(true);
    expect(a.find((c) => c.slug === "fixture-bob-project")?.isMine).toBe(false);
    // B favorited fixture-listed and A's deleted fixture-deleted-recent.
    expect(slugsOf(await clientAs(B.subject!).query(listMyFavorites, {}))).toEqual(["fixture-listed"]);
  });

  it("isFavorite on my projects follows the caller's own favorite rows", async () => {
    const a = await clientAs(A.subject!).query(listMine, {});
    expect(a.filter((c) => c.isFavorite).map((c) => c.slug)).toEqual(["fixture-listed"]);
  });

  it("category counts per view", async () => {
    const counts = async (c: Client, view: View) => c.query(myCategoryCounts, { view });
    const a = clientAs(A.subject!);
    expect(await counts(a, "mine")).toEqual({ web: expectedOwn("a", false).length });
    expect(await counts(a, "deleted")).toEqual({ web: 2 });
    expect(await counts(a, "favorites")).toEqual({ web: 2 });
    expect(await counts(clientAs(B.subject!), "favorites")).toEqual({ web: 1 });
    expect(await counts(clientAs(B.subject!), "deleted")).toEqual({});
  });

  it("anonymous, deleting, unlinked and admin-without-projects callers get empty answers", async () => {
    for (const c of [anonymousClient(), clientAs(deleting.subject!), clientAs("user_fixture_unlinked"), clientAs(admin.subject!)]) {
      expect(await lists(c)).toEqual({ mine: [], deleted: [], favorites: [] });
      for (const view of ["mine", "favorites", "deleted"] as const) expect(await c.query(myCategoryCounts, { view })).toEqual({});
    }
  });

  it("an unknown view is refused by the validator", async () => {
    await expect(clientAs(A.subject!).query(myCategoryCounts, { view: "everyone" as View })).rejects.toThrow();
  });

  it("rows carry no email, provider subject, role, tier or owner ID", async () => {
    for (const persona of [A, B]) {
      const all = await lists(clientAs(persona.subject!));
      const text = JSON.stringify(all);
      for (const secret of [A.profile!.email, B.profile!.email, A.subject!, B.subject!, '"role"', '"tier"', "ownerId", "userId"]) {
        expect(text).not.toContain(secret);
      }
      for (const card of [...all.mine, ...all.deleted, ...all.favorites]) {
        expect(Object.keys(card).sort()).toEqual(CARD_KEYS);
        expect(Object.keys(card.owner ?? {}).sort()).toEqual(card.owner ? ["avatarUrl", "fullName", "username"] : []);
      }
    }
  });

  // D08g4b: the handover is gone; fixtures:linkPersona leaves the same end state.
  it("a Better Auth login linked to A gets A's lists; a fresh one gets none", async () => {
    const login = async (label: string) => {
      const email = syntheticEmail(label);
      const res = await signUp(email, SYNTHETIC_PASSWORD);
      expect(res.status).toBe(200);
      return { token: (await convexToken(res.jar))!, authUserId: (await authState(email))!.authUserId };
    };
    const fresh = await login("d02r-fresh");
    expect(await lists(clientWithToken(fresh.token))).toEqual({ mine: [], deleted: [], favorites: [] });

    const a = await login("d02r-a");
    await linkPersona(A.subject!, a.authUserId);
    // A's cached login is unlinked by this; the next clientAs(A) signs in again.
    forgetPersonaLogins();
    const viaBetterAuth = await lists(clientWithToken(a.token));
    expect(viaBetterAuth).toEqual(await lists(clientAs(A.subject!)));
  });

  // D02r-a answers on Supabase vs these on Convex, same fixtures. Supabase has
  // no visibility column, so its "private" fixture is an ordinary project; it
  // belongs to A's own list on both sides.
  describe.skipIf(!testDbAvailable())("compared with the Supabase handlers", () => {
    let sql: postgres.Sql;
    let projectsRoute: typeof import("../../src/app/api/projects/route.js");
    let countsRoute: typeof import("../../src/app/api/categories/counts/route.js");

    beforeAll(async () => {
      sql = await connectTestDb();
      await cleanupFixtures(sql);
      await loadFixtures(sql, set);
      projectsRoute = await import("../../src/app/api/projects/route.js");
      countsRoute = await import("../../src/app/api/categories/counts/route.js");
    });
    afterAll(async () => {
      signInAs(null);
      await cleanupFixtures(sql);
      await sql.end();
    });

    const supabaseRows = async (query: string) => {
      const res = await projectsRoute.GET(new NextRequest(`http://localhost:3100/api/projects?${query}&limit=50`));
      return (JSON.parse(await res.text()).data as { slug: string; tags: string[]; total_favorites: string; isFavorite: boolean }[]);
    };
    const supabaseCounts = async (query: string) => {
      const res = await countsRoute.GET(new NextRequest(`http://localhost:3100/api/categories/counts?${query}`));
      return JSON.parse(await res.text()).data as Record<string, number>;
    };

    for (const persona of [A, B]) {
      it(`persona ${persona.key}: same projects, tags, favorite counts and flags in every view`, async () => {
        signInAs(persona.subject);
        const convex = await lists(clientAs(persona.subject!));
        const supabase = {
          mine: await supabaseRows(`userId=x`),
          deleted: await supabaseRows(`userId=x&showDeleted=true`),
          favorites: await supabaseRows(`userId=x&showFavorites=true`),
        };
        for (const view of ["mine", "deleted", "favorites"] as const) {
          const norm = (rows: { slug: string; tags: string[]; favorites: number; isFavorite: boolean }[]) =>
            rows.map((r) => ({ ...r, tags: [...r.tags].sort() })).sort((x, y) => x.slug.localeCompare(y.slug));
          expect(norm(convex[view].map((c) => ({ slug: c.slug, tags: c.tags, favorites: c.favoriteCount, isFavorite: c.isFavorite }))), view).toEqual(
            norm(supabase[view].map((r) => ({ slug: r.slug, tags: r.tags, favorites: Number(r.total_favorites), isFavorite: r.isFavorite }))),
          );
        }
        expect(await clientAs(persona.subject!).query(myCategoryCounts, { view: "mine" })).toEqual(await supabaseCounts("userId=x"));
        expect(await clientAs(persona.subject!).query(myCategoryCounts, { view: "deleted" })).toEqual(await supabaseCounts("userId=x&deleted=true"));
        expect(await clientAs(persona.subject!).query(myCategoryCounts, { view: "favorites" })).toEqual(await supabaseCounts("userId=x&favorites=true"));
      });
    }
  });
});
