// D09 S00.2: the public search projection and the synthetic search fixtures.
// The projection is pure and unused so far; these tests pin its privacy rules
// before anything indexes it.

import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_TEXT,
  PUBLIC_SEARCH_DOC_KEYS,
  SEARCH_HIT_KEYS,
  SEARCH_PROJECTION_VERSION,
  assertPublicSearchDoc,
  toPublicSearchDoc,
  type SearchSourceProject,
} from "@/backend/search/public-search-doc";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { INELIGIBLE_IDS, RELEVANCE_CASES, SEARCH_CORPUS } from "../fixtures/search/relevance";
import { NEVER_EQUIVALENT, SEARCH_VOCABULARY } from "../fixtures/search/vocabulary";

const base: SearchSourceProject = {
  id: "k17abc",
  slug: "my-project",
  title: "My project",
  description: "Does things",
  category: "web",
  categoryData: { framework: "Next.js", secretNotes: "not shown" },
  fieldOrder: ["framework"],
  visibility: "public",
  status: "active",
  listed: true,
  favoriteCount: 5,
  rankingFavoriteCount: 4,
  contentVersion: 3,
  createdAt: 1,
  updatedAt: 2,
};
const owner = { username: "ada-builds", fullName: "Ada Fixture" };
const tags = [
  { id: "t1", name: "Next.js", status: "active" as const },
  { id: "t2", name: "jQuery", status: "retired" as const },
];

describe("toPublicSearchDoc", () => {
  it("builds exactly the public keys, with the version and the source version", () => {
    const doc = toPublicSearchDoc(base, owner, tags)!;
    expect(Object.keys(doc).sort()).toEqual([...PUBLIC_SEARCH_DOC_KEYS].sort());
    expect(doc.projectionVersion).toBe(SEARCH_PROJECTION_VERSION);
    expect(doc.sourceVersion).toBe(3);
    expect(doc.route).toBe("/projects/my-project");
    expect(() => assertPublicSearchDoc(doc)).not.toThrow();
  });

  it.each([
    ["private", { visibility: "private" as const }],
    ["deleted", { status: "deleted" as const }],
    ["unlisted", { listed: false }],
  ])("returns null for a %s project", (_, change) => {
    expect(toPublicSearchDoc({ ...base, ...change }, owner, tags)).toBeNull();
  });

  it("keeps only active tags, in text and facets", () => {
    const doc = toPublicSearchDoc(base, owner, tags)!;
    expect(doc.tags).toEqual([{ id: "t1", name: "Next.js" }]);
    expect(doc.searchText).toContain("Next.js");
    expect(doc.searchText).not.toContain("jQuery");
  });

  it("keeps only the category fields the page shows", () => {
    const doc = toPublicSearchDoc(base, owner, tags)!;
    expect(doc.categoryData).toEqual({ framework: "Next.js" });
    expect(JSON.stringify(doc)).not.toContain("not shown");
  });

  it("names the owner by username and display name only", () => {
    const leaky = { ...owner, email: "ada@example.test", userId: "user_2abc", tier: "pro" } as typeof owner;
    const doc = toPublicSearchDoc(base, leaky, tags)!;
    expect(doc.owner).toEqual({ username: "ada-builds", fullName: "Ada Fixture" });
    expect(JSON.stringify(doc)).not.toMatch(/example\.test|user_2abc|pro"/);
  });

  it("allows an orphaned project with no public owner", () => {
    const doc = toPublicSearchDoc(base, null, tags)!;
    expect(doc.owner).toBeNull();
    expect(() => assertPublicSearchDoc(doc)).not.toThrow();
  });

  it("bounds searchText", () => {
    const doc = toPublicSearchDoc({ ...base, description: "x ".repeat(10_000) }, owner, tags)!;
    expect(doc.searchText.length).toBeLessThanOrEqual(MAX_SEARCH_TEXT);
  });

  it("keeps ranking inputs out of what a hit may return", () => {
    expect(SEARCH_HIT_KEYS).not.toContain("ranking");
    expect(SEARCH_HIT_KEYS).not.toContain("searchText");
  });

  it("encodes the slug in the route", () => {
    expect(toPublicSearchDoc({ ...base, slug: "a b/c" }, owner, tags)!.route).toBe("/projects/a%20b%2Fc");
  });
});

describe("assertPublicSearchDoc", () => {
  const good = () => toPublicSearchDoc(base, owner, tags)!;

  it("rejects an extra top-level key", () => {
    expect(() => assertPublicSearchDoc({ ...good(), ownerId: "u1" })).toThrow(/ownerId is not public/);
  });
  it("rejects an extra owner key", () => {
    expect(() => assertPublicSearchDoc({ ...good(), owner: { ...owner, email: "a@b.co" } })).toThrow(/owner.email/);
  });
  it("rejects an email-shaped owner name", () => {
    expect(() => assertPublicSearchDoc({ ...good(), owner: { username: "a@b.co", fullName: null } })).toThrow(/email/);
  });
  it("rejects a provider-subject entity ID", () => {
    expect(() => assertPublicSearchDoc({ ...good(), entityId: "user_2abcdef" })).toThrow(/entityId/);
  });
  it("rejects an extra ranking input", () => {
    expect(() => assertPublicSearchDoc({ ...good(), ranking: { favorites: 1, selfFavorite: true } })).toThrow(/ranking.selfFavorite/);
  });
  it("rejects a missing key", () => {
    const rest: Record<string, unknown> = { ...good() };
    delete rest.searchText;
    expect(() => assertPublicSearchDoc(rest)).toThrow(/searchText is missing/);
  });
});

describe("search fixtures", () => {
  const ids = new Set(SEARCH_CORPUS.map((c) => c.project.id));
  const eligible = new Set(SEARCH_CORPUS.filter((c) => toPublicSearchDoc(c.project, c.owner, c.tags)).map((c) => c.project.id));

  it("has unique project IDs and only known categories", () => {
    expect(ids.size).toBe(SEARCH_CORPUS.length);
    for (const c of SEARCH_CORPUS) expect(Object.keys(PROJECT_CATEGORIES)).toContain(c.project.category);
  });

  it("projects every eligible corpus entry through the contract, and none of the ineligible ones", () => {
    for (const c of SEARCH_CORPUS) {
      const doc = toPublicSearchDoc(c.project, c.owner, c.tags);
      if (INELIGIBLE_IDS.includes(c.project.id)) expect(doc).toBeNull();
      else expect(() => assertPublicSearchDoc(doc)).not.toThrow();
    }
  });

  it("labels only corpus projects, never an ineligible one as strong or weak, and never one both ways", () => {
    const caseIds = new Set<string>();
    for (const r of RELEVANCE_CASES) {
      expect(caseIds.has(r.id)).toBe(false);
      caseIds.add(r.id);
      const all = [...r.strong, ...(r.weak ?? []), ...(r.forbidden ?? [])];
      for (const id of all) expect(ids.has(id), `${r.id}: ${id}`).toBe(true);
      for (const id of [...r.strong, ...(r.weak ?? [])]) expect(eligible.has(id), `${r.id}: ${id}`).toBe(true);
      const good = new Set([...r.strong, ...(r.weak ?? [])]);
      for (const id of r.forbidden ?? []) expect(good.has(id), `${r.id}: ${id}`).toBe(false);
      expect(r.strong.length).toBeLessThanOrEqual(10);
    }
  });

  it("covers every query kind the search plan names", () => {
    const kinds = new Set(RELEVANCE_CASES.map((r) => r.kind));
    for (const k of ["exact", "prefix", "misspelling", "alias", "phrase", "mixed", "special", "filter", "creator", "no-results", "people", "privacy"]) {
      expect(kinds.has(k as never), k).toBe(true);
    }
  });

  it("creator-scoped cases only expect that creator's projects", () => {
    for (const r of RELEVANCE_CASES.filter((c) => c.scope?.handle)) {
      for (const id of [...r.strong, ...(r.weak ?? [])]) {
        expect(SEARCH_CORPUS.find((c) => c.project.id === id)!.owner?.username, `${r.id}: ${id}`).toBe(r.scope!.handle);
      }
    }
  });

  it("vocabulary: unique IDs, no alias claimed by two technologies, never-equivalent pairs kept apart", () => {
    const vocabIds = new Set(SEARCH_VOCABULARY.map((v) => v.id));
    expect(vocabIds.size).toBe(SEARCH_VOCABULARY.length);
    const owners = new Map<string, string>();
    for (const v of SEARCH_VOCABULARY) {
      for (const key of [v.id, v.label.toLowerCase(), ...v.aliases.map((a) => a.toLowerCase())]) {
        const prior = owners.get(key);
        expect(prior === undefined || prior === v.id, `${key}: ${prior} and ${v.id}`).toBe(true);
        owners.set(key, v.id);
      }
      for (const n of v.narrower ?? []) expect(vocabIds.has(n), n).toBe(true);
    }
    for (const [a, b] of NEVER_EQUIVALENT) {
      expect(vocabIds.has(a) && vocabIds.has(b), `${a}/${b}`).toBe(true);
      const va = SEARCH_VOCABULARY.find((v) => v.id === a)!;
      expect(va.aliases.map((x) => owners.get(x.toLowerCase()))).not.toContain(b);
      expect(va.narrower ?? []).not.toContain(b);
    }
  });

  it("fixtures carry no email addresses", () => {
    const text = JSON.stringify([SEARCH_CORPUS, RELEVANCE_CASES, SEARCH_VOCABULARY]);
    expect(text).not.toMatch(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/);
  });
});
