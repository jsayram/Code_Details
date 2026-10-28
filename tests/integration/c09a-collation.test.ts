// C09a: how Convex orders strings in an index, measured on the local backend,
// against the source database's C.UTF-8 order (P02, P07 §9) on the isolated
// test DB. Mixed case, diacritics, digits, punctuation, a ligature, sharp s,
// CJK and an emoji (outside the BMP, where UTF-16 and code-point order part).
// The measured orders are written to test-results/c09a-collation.json.
import fs from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { clearConvexFixtures, convexAvailable, listedTitleOrder, loadConvexFixtures, sortKey } from "../fixtures/convex";
import { connectTestDb, testDbAvailable } from "../support/test-db";

export const COLLATION_STRINGS = [
  "apple", "Apple", "APPLE", "aB", "ab", "Äpfel", "apfel", "Zebra", "zebra", "éclair", "eclair", "Éclair",
  "10 things", "2 things", "_under", "-dash", ".dot", "a b", "a-b", "a_b", "ß", "ss", "ﬁle", "file",
  "Ångström", "Øresund", "résumé", "resume", "日本", "Ω", "émoji 🚀", "emoji ☃", "\u{1F680} rocket", "� replacement",
];

/** Unicode code-point order (what UTF-8 byte order gives). */
const byCodePoint = (a: string, b: string) => {
  const x = [...a].map((c) => c.codePointAt(0)!);
  const y = [...b].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
/** JavaScript's default sort: UTF-16 code units. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const ready = convexAvailable() && testDbAvailable();

describe.skipIf(!ready)("C09a Convex index string order vs source C.UTF-8", () => {
  let sql: postgres.Sql;
  let convexRaw: string[];
  let convexKey: string[];
  let pgRaw: string[];
  let pgLower: string[];
  let pgLowerAsKey: string[];

  const extra = (keyOf: (s: string) => string) =>
    COLLATION_STRINGS.map((s, i) => ({
      ownerKey: "a", title: s, titleSortKey: keyOf(s), slug: `collation-${i}`, category: "web",
      links: [], visibility: "public", status: "active", tagKeys: [], favoriteCount: 0, rankingFavoriteCount: 0,
      shuffleKey: 0, createdAt: 0, updatedAt: 0,
    }));
  // Only the collation rows: the fixture set's own projects go private for this measurement.
  const set = generateFixtures();
  set.projects = set.projects.filter((p) => p.case === "private");

  beforeAll(async () => {
    sql = await connectTestDb();
    // 1. Raw strings as the index key: measures Convex's own comparison.
    await clearConvexFixtures();
    await loadConvexFixtures(set, undefined, extra((s) => s));
    convexRaw = await listedTitleOrder();
    // 2. The target model's key (lowercase NFKC, P07 §9).
    await clearConvexFixtures();
    await loadConvexFixtures(set, undefined, extra(sortKey));
    convexKey = await listedTitleOrder();
    await clearConvexFixtures();

    const db = await sql<{ datcollate: string }[]>`select datcollate from pg_database where datname = current_database()`;
    expect(db[0].datcollate).toBe("C.UTF-8");
    pgRaw = (await sql<{ s: string }[]>`select s from unnest(${COLLATION_STRINGS}::text[]) s order by s`).map((r) => r.s);
    // Today's alphabetical sort is ORDER BY LOWER(title) (P06).
    pgLower = (await sql<{ s: string }[]>`select s from unnest(${COLLATION_STRINGS}::text[]) s order by lower(s), s`).map((r) => r.s);
    pgLowerAsKey = (await sql<{ s: string }[]>`select lower(s) as s from unnest(${COLLATION_STRINGS}::text[]) s`).map((r) => r.s);
  });

  afterAll(async () => {
    const out = {
      measuredAt: new Date().toISOString(),
      strings: COLLATION_STRINGS,
      convexIndexRaw: convexRaw,
      jsCodePoint: [...COLLATION_STRINGS].sort(byCodePoint),
      jsCodeUnit: [...COLLATION_STRINGS].sort(byCodeUnit),
      postgresCUtf8Raw: pgRaw,
      postgresLowerTitleOrder: pgLower,
      convexTitleSortKeyOrder: convexKey,
      sortKeyVsPostgresLower: COLLATION_STRINGS.map((s, i) => ({ s, sortKey: sortKey(s), pgLower: pgLowerAsKey[i] })).filter((r) => r.sortKey !== r.pgLower),
    };
    fs.mkdirSync(path.resolve(__dirname, "../../test-results"), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, "../../test-results/c09a-collation.json"), JSON.stringify(out, null, 2));
    await sql?.end();
  });

  it("Convex orders index strings by Unicode code point (UTF-8 byte order)", () => {
    expect(convexRaw).toEqual([...COLLATION_STRINGS].sort(byCodePoint));
  });

  it("that is not JavaScript's default UTF-16 sort once characters outside the BMP appear", () => {
    expect([...COLLATION_STRINGS].sort(byCodeUnit)).not.toEqual(convexRaw);
  });

  // Measured 2026-10-28 on the P02 image (Postgres 15.8, libc C.UTF-8): the
  // source puts strings that START with a character outside the BMP (here an
  // emoji) before everything else, even ASCII punctuation; Convex puts them
  // last. Apart from that the two orders are identical. Intended change
  // (C_REPORT, C09a): Convex's order is kept.
  const startsAstral = (s: string) => s.codePointAt(0)! > 0xffff;

  it("source C.UTF-8 matches Convex except for strings starting outside the BMP", () => {
    expect(pgRaw.filter((s) => !startsAstral(s))).toEqual(convexRaw.filter((s) => !startsAstral(s)));
    const astral = COLLATION_STRINGS.filter(startsAstral);
    expect(pgRaw.slice(0, astral.length)).toEqual(astral);
    expect(convexRaw.slice(-astral.length)).toEqual(astral);
  });

  it("titleSortKey differs from today's LOWER(title) only where NFKC folds a compatibility character", () => {
    const differing = COLLATION_STRINGS.filter((s, i) => sortKey(s) !== pgLowerAsKey[i]);
    expect(differing).toEqual(["ﬁle"]);
  });

  it("titleSortKey order equals code-point order of the keys", () => {
    const expected = [...COLLATION_STRINGS].map(sortKey).sort(byCodePoint);
    expect(convexKey).toEqual(expected);
  });
});
