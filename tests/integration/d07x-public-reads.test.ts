// D07x-b: the other public lists on Convex under both development switches:
// the community category counts, one owner's shared-projects grid and its
// category counts, and the tag list, checked against the fixtures. (E03: the
// in-process comparison with the Supabase routes went with those routes.)
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";


const publicCategoryCounts = makeFunctionReference<"query", { handle?: string }, Record<string, number> | null>("projects:publicCategoryCounts");
const listAll = makeFunctionReference<"query", Record<string, never>, { id: string; name: string; count: number }[]>("tags:listAll");

const set = generateFixtures();
const { a: A, b: B, deleting } = set.personas;
const listed = set.projects.filter((p) => !p.purged && !p.deletedAt && p.visibility === "public");
const countBy = (projects: typeof listed) =>
  projects.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.category]: (acc[p.category] ?? 0) + 1 }), {});

describe.skipIf(!convexAvailable())("D07x-b Convex public reads", () => {
  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("category counts cover listed projects only, community-wide and per handle", async () => {
    const c = anonymousClient();
    expect(await c.query(publicCategoryCounts, {})).toEqual(countBy(listed));
    expect(await c.query(publicCategoryCounts, { handle: B.profile!.username })).toEqual({ web: 1 });
    expect(await c.query(publicCategoryCounts, { handle: A.profile!.username })).toEqual(countBy(listed.filter((p) => p.ownerKey === "a")));
    expect(await c.query(publicCategoryCounts, { handle: "fixture-nobody" })).toBeNull();
    expect(await c.query(publicCategoryCounts, { handle: deleting.profile!.username })).toBeNull();
  });

  it("the tag list has every tag with its listed-project count, most used first", async () => {
    const tags = await anonymousClient().query(listAll, {});
    const expected = set.tags.map((t) => ({ name: t.name, count: listed.filter((p) => p.tagIds.includes(t.id)).length }));
    expect(tags.map(({ name, count }) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name))).toEqual(
      expected.sort((x, y) => x.name.localeCompare(y.name)),
    );
    const counts = tags.map((t) => t.count);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  // E03: the on/off route comparison went with the Supabase routes.
  // tests/integration/d09-public-access.test.ts calls the Convex routes over HTTP.
});
