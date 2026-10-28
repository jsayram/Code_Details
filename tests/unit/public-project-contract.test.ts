// C02/C04: the public project contract itself. The readers' integration tests
// check real data against it; these check that the guard rejects what it must.
import { describe, expect, it } from "vitest";
import {
  PUBLIC_PROJECT_KEYS,
  type PublicProject,
  assertPublicProject,
  publicCategoryData,
  publicLinks,
} from "@/backend/projects/public-project";
import { generateFixtures } from "../fixtures/generate";
import { expectedPublicProject } from "../support/public-project-spec";

const set = generateFixtures();
const valid = (): PublicProject => ({ id: "opaque-id", ...expectedPublicProject(set, "fixture-listed")! });

describe("public project contract", () => {
  it("accepts the expected listed fixture", () => {
    expect(() => assertPublicProject(valid())).not.toThrow();
  });

  it("has exactly the agreed top-level fields; no rankingFavoriteCount, email, subject or tier", () => {
    expect([...PUBLIC_PROJECT_KEYS].sort()).toEqual(Object.keys(valid()).sort());
    for (const k of ["rankingFavoriteCount", "user_id", "owner_email_address", "owner_user_id", "owner_tier", "deleted_at", "ownerId"]) {
      expect(PUBLIC_PROJECT_KEYS as readonly string[]).not.toContain(k);
    }
  });

  it.each([
    ["an extra top-level field", (p: Record<string, unknown>) => (p.user_id = "x")],
    ["rankingFavoriteCount", (p: Record<string, unknown>) => (p.rankingFavoriteCount = 1)],
    ["an extra owner field", (p: Record<string, unknown>) => ((p.owner as Record<string, unknown>).email = "a@b.invalid")],
    ["an email as the username", (p: Record<string, unknown>) => ((p.owner as Record<string, unknown>).username = "alice@synthetic.invalid")],
    ["a provider subject as the ID", (p: Record<string, unknown>) => (p.id = "user_fixture_a")],
    ["a missing field", (p: Record<string, unknown>) => delete p.listed],
    ["visibility private", (p: Record<string, unknown>) => (p.visibility = "private")],
    ["listed false", (p: Record<string, unknown>) => (p.listed = false)],
    ["a string favorite count", (p: Record<string, unknown>) => (p.favoriteCount = "2")],
    ["an extra link field", (p: Record<string, unknown>) => ((p.links as Record<string, unknown>[])[0].ownerEmail = "x")],
  ])("rejects %s", (_name, mutate) => {
    const p = valid() as unknown as Record<string, unknown>;
    mutate(p);
    expect(() => assertPublicProject(p)).toThrow(/contract violated/);
  });

  it("allows an email address inside the creator's own description", () => {
    const p = valid();
    p.description = "Contact me at someone@example.invalid";
    expect(() => assertPublicProject(p)).not.toThrow();
  });

  it("accepts an orphaned project with a null owner", () => {
    const p = valid();
    p.owner = null;
    expect(() => assertPublicProject(p)).not.toThrow();
  });

  it("keeps only displayed category fields, in fieldOrder", () => {
    expect(publicCategoryData({ a: 1, hidden: "x", b: [] }, ["b", "a"])).toEqual({ b: [], a: 1 });
    expect(publicCategoryData({ a: 1 }, null)).toBeNull();
    expect(publicCategoryData({ a: 1 }, [])).toBeNull();
    expect(publicCategoryData(null, ["a"])).toBeNull();
  });

  it("keeps only url, label and type of each link and drops malformed entries", () => {
    expect(publicLinks([{ url: "https://x.invalid", label: "X", secret: 1 }, { label: "no url" }, null, "str"])).toEqual([
      { url: "https://x.invalid", label: "X" },
    ]);
    expect(publicLinks(null)).toEqual([]);
  });

  it("private, deleted, purged and missing fixtures all expect not-found", () => {
    for (const slug of ["fixture-private", "fixture-deleted-recent", "fixture-deleted-long-ago", "fixture-purged", "fixture-nope"]) {
      expect(expectedPublicProject(set, slug)).toBeNull();
    }
  });
});
