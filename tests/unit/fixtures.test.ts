import { describe, expect, it } from "vitest";
import { MAX_PROJECT_TAGS, PROJECT_TEXT_LIMITS } from "@/constants/project-limits";
import {
  FIXTURE_EMAIL_DOMAIN,
  FIXTURE_ID_PREFIX,
  FIXTURE_SUBJECT_PREFIX,
  fixtureDigest,
  generateFixtures,
  placeholderPng,
} from "../fixtures/generate";

const set = generateFixtures();

describe("fixture generator", () => {
  it("is deterministic for a seed and different across seeds", () => {
    expect(generateFixtures()).toEqual(set);
    expect(fixtureDigest(generateFixtures())).toBe(fixtureDigest(set));
    expect(fixtureDigest(generateFixtures("other-seed"))).not.toBe(fixtureDigest(set));
  });

  it("covers every P07 §10 persona", () => {
    expect(Object.keys(set.personas).sort()).toEqual(
      ["a", "admin", "anonymous", "b", "deleting", "emailUsername", "noProfile", "renamed", "reserved"],
    );
    expect(set.personas.anonymous.subject).toBeNull();
    expect(set.personas.noProfile.subject).not.toBeNull();
    expect(set.personas.noProfile.profile).toBeNull();
    expect(set.personas.deleting.accountState).toBe("deleting");
    expect(set.usernameHistory[0].subject).toBe(set.personas.renamed.subject);
    expect(set.scenarios.map((s) => s.key)).toContain("reservedUsernameClaim");
  });

  it("covers the listed project cases at their limits", () => {
    const byCase = Object.fromEntries(set.projects.map((p) => [p.case, p]));
    expect(byCase.maxLength.title).toHaveLength(PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH);
    expect(byCase.maxLength.slug).toHaveLength(PROJECT_TEXT_LIMITS.MAX_SLUG_LENGTH);
    expect(byCase.maxLength.description).toHaveLength(PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH);
    expect(byCase.fifteenTags.tagIds).toHaveLength(MAX_PROJECT_TAGS);
    expect(byCase.oneTag.tagIds).toHaveLength(1);
    expect(byCase.noDescription.tagIds).toHaveLength(0);
    expect(byCase.noDescription.description).toBeNull();
    expect(byCase.private.visibility).toBe("private");
    expect(byCase.purged.purged).toBe(true);
    expect(byCase.changedSlug.previousSlug).not.toBe(byCase.changedSlug.slug);
    expect(new Set(byCase.caseVariantTags.tagInput.map((t) => t.toLowerCase())).size).toBe(1);
    expect(byCase.unicode.title).toMatch(/[؀-ۿ]/);
    expect(byCase.deletedLongAgo.deletedAt! < byCase.deletedRecent.deletedAt!).toBe(true);
    expect(byCase.ownedByB.ownerKey).toBe("b");
    expect(byCase.ownedByEmailUsername.ownerKey).toBe("emailUsername");
    expect(set.personas.emailUsername.profile!.username).toMatch(/^[^@]+@synthetic\.invalid$/);
    expect(set.personas.emailUsername.profile!.fullName).toBeNull();
  });

  it("covers self-favorites, favorites on deleted projects and tag-name edge cases", () => {
    expect(set.favorites.map((f) => f.note).sort()).toEqual(["onDeleted", "other", "other", "self"]);
    const names = set.tags.map((t) => t.name);
    for (const n of ["C", "C++", "C#", ".NET", "Node.js", "Next.js", "React Native", "Postgres", "PostgreSQL", "@scope/package"]) {
      expect(names).toContain(n);
    }
    expect(set.images.filter((i) => i.deletedAt)).toHaveLength(1);
  });

  it("keeps IDs and natural keys unique", () => {
    const ids = [
      ...Object.values(set.personas).flatMap((p) => (p.profile ? [p.profile.id] : [])),
      ...set.tags.map((t) => t.id),
      ...set.projects.map((p) => p.id),
      ...set.favorites.map((f) => f.id),
      ...set.images.map((i) => i.id),
      ...set.tagSubmissions.map((t) => t.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(new RegExp(`^${FIXTURE_ID_PREFIX}[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`));
    const slugs = set.projects.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const lower = set.tags.map((t) => t.name.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("contains no real data", () => {
    const text = JSON.stringify(set);
    for (const email of text.match(/[\w.+-]+@[\w.-]+\.[a-z]+/gi) ?? []) {
      if (email.startsWith("@scope")) continue;
      expect(email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`)).toBe(true);
    }
    for (const url of text.match(/https?:\/\/[^"\s]+/g) ?? []) {
      expect(new URL(url).hostname.endsWith(".invalid")).toBe(true);
    }
    for (const p of Object.values(set.personas)) {
      if (p.subject) expect(p.subject.startsWith(FIXTURE_SUBJECT_PREFIX)).toBe(true);
    }
    expect(text).not.toMatch(/user_[0-9A-Za-z]{20,}/); // Clerk-shaped subjects
  });

  it("generates valid, repeatable placeholder PNGs", () => {
    const png = placeholderPng(4, 3);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(3);
    expect(placeholderPng(4, 3).equals(png)).toBe(true);
  });
});
