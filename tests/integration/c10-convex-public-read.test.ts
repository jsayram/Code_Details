// C09–C12: the public project query on the task-owned local Convex backend,
// with the synthetic fixtures loaded through the internal fixture functions.
// Every call to the public query uses a client with no credentials at all,
// which is exactly what an anonymous browser could send.
import { ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_PROJECT_KEYS, assertPublicProject } from "@/backend/projects/public-project";
import { generateFixtures } from "../fixtures/generate";
import {
  anonymousClient,
  clearConvexFixtures,
  convexAvailable,
  convexFixtureCounts,
  getPublicBySlug,
  loadConvexFixtures,
  toConvexArgs,
} from "../fixtures/convex";
import { expectedPublicProject } from "../support/public-project-spec";

const set = generateFixtures();
const A = set.personas.a;
const anon = anonymousClient();
const read = (slug: string) => anon.query(getPublicBySlug, { slug });

describe.skipIf(!convexAvailable())("C09–C12 Convex public project read", () => {
  let ids: Record<string, string>;

  beforeAll(async () => {
    await clearConvexFixtures();
    ids = await loadConvexFixtures(set);
  });

  afterAll(async () => {
    await clearConvexFixtures();
  });

  describe("C09 fixture", () => {
    it("loads every non-purged fixture project, persona with a subject, profile and tag", async () => {
      // E03: the personas' subjects key them in importMap now, not as clerk auth links.
      expect(await convexFixtureCounts()).toEqual({ favorites: 4, projects: 13, profiles: 7, tags: 16, authLinks: 0, users: 8 });
      expect(Object.keys(ids).sort()).toEqual(set.projects.filter((p) => !p.purged).map((p) => p.slug).sort());
    });

    it("is reproducible: the mapped arguments are identical on every run", () => {
      expect(JSON.stringify(toConvexArgs(generateFixtures()))).toBe(JSON.stringify(toConvexArgs(set)));
    });

    it("refuses to load over existing rows", async () => {
      await expect(loadConvexFixtures(set)).rejects.toThrow(/not empty/);
    });

    it("reloads to the same public results after clear", async () => {
      const before = await read("fixture-listed");
      await clearConvexFixtures();
      ids = await loadConvexFixtures(set);
      const after = await read("fixture-listed");
      expect({ ...after, id: "x" }).toEqual({ ...before, id: "x" });
    });
  });

  describe("C10 public shape", () => {
    it.each(set.projects.map((p) => [p.case, p.slug]))("%s matches the C02 spec", async (_case, slug) => {
      const got = await read(slug);
      const expected = expectedPublicProject(set, slug, "convex");
      if (expected === null) {
        expect(got).toBeNull();
        return;
      }
      assertPublicProject(got);
      const { id, ...rest } = got;
      expect(id).toBe(ids[slug]);
      expect(rest).toEqual(expected);
    });

    it("returns exactly the contract's keys, without rankingFavoriteCount", async () => {
      const got = (await read("fixture-listed")) as Record<string, unknown>;
      expect(Object.keys(got).sort()).toEqual([...PUBLIC_PROJECT_KEYS].sort());
      expect(got).not.toHaveProperty("rankingFavoriteCount");
      // A's self-favorite counts in favoriteCount (2) but not in ranking (1).
      expect(got.favoriteCount).toBe(2);
    });

    it("never carries the owner's email, subject, user or profile IDs, role or tier", async () => {
      const got = await read("fixture-listed");
      const text = JSON.stringify(got);
      expect(text).not.toContain(A.profile!.email);
      expect(text).not.toContain("user_fixture_");
      expect(text).not.toMatch(/"(pro|free|admin|user)"/);
      expect(text).not.toMatch(/ownerId|userId|authUserId|tier|role/);
    });
  });

  describe("C11 missing", () => {
    it("a missing slug, an empty slug and a case variant all return null", async () => {
      for (const slug of ["fixture-does-not-exist", "", "FIXTURE-LISTED", "fixture-listed "]) {
        expect(await read(slug), JSON.stringify(slug)).toBeNull();
      }
    });

    it("a slug from slug history isn't resolved by this query (redirects are later scope)", async () => {
      expect(await read("fixture-slug-old")).toBeNull();
    });

    it("rejects a non-string slug with an argument validation error, not data", async () => {
      const raw = makeFunctionReference<"query">("projects:getPublicBySlug");
      await expect(anon.query(raw, { slug: 42 } as never)).rejects.toThrow(/Validator|validator|ArgumentValidationError/);
      await expect(anon.query(raw, { slug: "x", ownerId: "y" } as never)).rejects.toThrow();
    });
  });

  describe("C12 private and deleted denial", () => {
    it("visibility=private returns null, the same as missing", async () => {
      expect(await read("fixture-private")).toBeNull();
    });

    it("status=deleted returns null, the same as missing (recent and long ago)", async () => {
      expect(await read("fixture-deleted-recent")).toBeNull();
      expect(await read("fixture-deleted-long-ago")).toBeNull();
    });

    it("an anonymous client can't call the internal fixture functions", async () => {
      for (const [kind, name] of [["query", "fixtures:counts"], ["query", "fixtures:listedTitleOrder"], ["query", "fixtures:snapshot"], ["mutation", "fixtures:clear"], ["mutation", "fixtures:load"]] as const) {
        const fn = makeFunctionReference<typeof kind>(name);
        const call = kind === "query" ? anon.query(fn as never, {}) : anon.mutation(fn as never, {});
        await expect(call, name).rejects.toThrow(/Could not find public function|not found/i);
      }
      expect((await convexFixtureCounts()).projects).toBe(13);
    });

    it("the deployment exposes no other public function that reads projects", async () => {
      // Every public function this phase ships; a new one has to be added here on purpose.
      for (const name of ["projects:list", "projects:get", "projects:getBySlug", "users:get", "profiles:get"]) {
        await expect(anon.query(makeFunctionReference<"query">(name), {}), name).rejects.toThrow(/Could not find public function/i);
      }
    });
  });
});

// Keeps the import used when the suite is skipped.
void ConvexError;
