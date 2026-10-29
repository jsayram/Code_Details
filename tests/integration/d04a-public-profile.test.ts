// D04a (P08 R07): the default Supabase path's public profile reads carry no
// email, provider subject, profile UUID or tier, the lookup no longer matches
// by email, and a legacy email-shaped username publishes its local part only.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { PUBLIC_PROFILE_ROW_KEYS } from "@/backend/profiles/public-profile";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const legacy = set.personas.emailUsername;
const withProfile = Object.values(set.personas).filter((p) => p.profile);

const url = (path: string) => new NextRequest(new URL(path, "http://localhost:3100"));
const body = async (res: Response) => JSON.parse(await res.text());
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

/** No fixture email, subject or profile UUID anywhere, and no private key names. */
function expectNothingPrivate(text: string) {
  for (const p of withProfile) {
    expect(text, p.key).not.toContain(p.profile!.email);
    expect(text, p.key).not.toContain(p.profile!.id);
  }
  for (const p of Object.values(set.personas)) if (p.subject) expect(text, p.key).not.toContain(p.subject);
  expect(text).not.toMatch(/"(?:email_address|tier|user_id|owner_user_id|owner_tier|owner_id|id)":/);
  expect(text).not.toContain("@synthetic.invalid");
}

describe.skipIf(!testDbAvailable())("D04a public profile reads (Supabase)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await connectTestDb();
  });
  beforeEach(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  describe("GET /api/profiles", () => {
    it("lists public fields and counts only", async () => {
      const route = await import("../../src/app/api/profiles/route.js");
      const res = await route.GET();
      const text = await res.text();
      const rows = JSON.parse(text).data as Record<string, unknown>[];
      const fixtureRows = rows.filter((r) => String(r.username).startsWith("fixture"));
      expect(fixtureRows.length).toBe(withProfile.length);
      for (const row of fixtureRows) {
        expect(Object.keys(row).sort()).toEqual([...PUBLIC_PROFILE_ROW_KEYS, "project_count", "total_favorites", "last_activity_date"].sort());
      }
      expect(fixtureRows.map((r) => r.username)).toContain("fixture.legacy");
      expectNothingPrivate(text);
    });
  });

  describe("GET /api/profiles/[username]", () => {
    it("returns the public projection", async () => {
      const route = await import("../../src/app/api/profiles/[username]/route.js");
      const res = await route.GET(url(`/api/profiles/${A.profile!.username}`), params({ username: A.profile!.username }));
      expect(res.status).toBe(200);
      const text = await res.text();
      const { profile } = JSON.parse(text).data;
      expect(Object.keys(profile).sort()).toEqual([...PUBLIC_PROFILE_ROW_KEYS].sort());
      expect(profile).toMatchObject({ username: "fixture-alice", full_name: "Alice Fixture", profile_image_url: A.profile!.imageUrl });
      expectNothingPrivate(text);
    });

    it("redirects an old username with the current public profile only", async () => {
      const route = await import("../../src/app/api/profiles/[username]/route.js");
      const res = await route.GET(url("/api/profiles/fixture-old-name"), params({ username: "fixture-old-name" }));
      const text = await res.text();
      expect(JSON.parse(text).data).toMatchObject({ redirect: true, currentUsername: "fixture-new-name", profile: { username: "fixture-new-name" } });
      expectNothingPrivate(text);
    });

    it("publishes a legacy email-shaped username as its local part", async () => {
      const route = await import("../../src/app/api/profiles/[username]/route.js");
      const res = await route.GET(url("/api/profiles/x"), params({ username: legacy.profile!.username }));
      const text = await res.text();
      expect(JSON.parse(text).data.profile.username).toBe("fixture.legacy");
      expectNothingPrivate(text);
    });
  });

  describe("GET /api/profiles/lookup/[username]", () => {
    const lookup = async (name: string, query = "") => {
      const route = await import("../../src/app/api/profiles/lookup/[username]/route.js");
      return route.GET(url(`/api/profiles/lookup/${encodeURIComponent(name)}${query}`), params({ username: encodeURIComponent(name) }));
    };

    it("finds a profile by username, public fields only", async () => {
      const res = await lookup(A.profile!.username);
      const text = await res.text();
      expect(Object.keys(JSON.parse(text).data.profile).sort()).toEqual([...PUBLIC_PROFILE_ROW_KEYS].sort());
      expectNothingPrivate(text);
    });

    it("no longer matches by email address (was an account-enumeration oracle)", async () => {
      const res = await lookup(A.profile!.email);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("fixture-alice");
    });

    it("serves the profile page's stats by username", async () => {
      const res = await lookup(A.profile!.username, "?includeStats=true");
      const text = await res.text();
      const { stats } = JSON.parse(text).data;
      expect(Object.keys(stats).sort()).toEqual([
        "activeProjects", "communityProjects", "joinedDate", "mostLikedProject",
        "projectsFavorited", "projectsReceivedFavorites", "totalLikes", "totalProjects", "totalTags",
      ]);
      expect(stats.activeProjects).toBeGreaterThan(0);
      expectNothingPrivate(text);
    });

    it("redirects an old username", async () => {
      const res = await lookup("fixture-old-name");
      expect((await body(res)).data).toMatchObject({ redirect: true, currentUsername: "fixture-new-name" });
    });
  });

  it("GET /api/profiles/by-id/[userId] returns the public projection", async () => {
    const route = await import("../../src/app/api/profiles/by-id/[userId]/route.js");
    const res = await route.GET(url(`/api/profiles/by-id/${A.subject}?includeStats=true`), params({ userId: A.subject! }));
    const text = await res.text();
    const data = JSON.parse(text).data;
    expect(Object.keys(data.profile).sort()).toEqual([...PUBLIC_PROFILE_ROW_KEYS].sort());
    expect(data.stats.activeProjects).toBeGreaterThan(0);
    // The request names the subject; the answer must not echo it back.
    expectNothingPrivate(text);
  });

  describe("project lists", () => {
    it("/api/shared-projects/[username] publishes a legacy owner's local part", async () => {
      const route = await import("../../src/app/api/shared-projects/[username]/route.js");
      const res = await route.GET(url(`/api/shared-projects/${encodeURIComponent(legacy.profile!.username)}`), params({ username: legacy.profile!.username }));
      const text = await res.text();
      const rows = JSON.parse(text).data.data as { profile: { username: string } }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.profile.username === "fixture.legacy")).toBe(true);
      expect(text).not.toContain("@synthetic.invalid");
    });

    it("/api/projects rows publish a legacy owner's local part", async () => {
      const route = await import("../../src/app/api/projects/route.js");
      const res = await route.GET(url("/api/projects?showAll=true&limit=50"));
      const text = await res.text();
      const rows = JSON.parse(text).data as { slug: string; profile: { username: string } }[];
      expect(rows.find((r) => r.slug === "fixture-legacy-owner")?.profile.username).toBe("fixture.legacy");
      expect(text).not.toContain("@synthetic.invalid");
    });
  });

  describe("callable actions", () => {
    it("fetchTopContributorsPublic carries no subject or tier", async () => {
      const { fetchTopContributorsPublic } = await import("../../src/app/actions/advanced-analytics.js");
      const rows = await fetchTopContributorsPublic(50);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["user_id"]));
      expect(rows.some((r) => "tier" in r)).toBe(false);
      expect(rows.map((r) => r.username)).toContain("fixture.legacy");
      expectNothingPrivate(JSON.stringify(rows));
    });

    it("the all-projects and any-user's-projects actions are gone", async () => {
      const actions = (await import("../../src/app/actions/projects.js")) as Record<string, unknown>;
      for (const name of ["getAllProjects", "getCachedAllProjects", "getUserProjects", "getCachedUserProjects"]) {
        expect(actions[name], name).toBeUndefined();
      }
      const dbActions = (await import("../../src/db/actions.js")) as Record<string, unknown>;
      expect(dbActions.getAccessibleProjectsServer).toBeUndefined();
    });

    it("readAllActiveProjects (server-only) carries no owner subject, UUID or tier", async () => {
      signInAs(B.subject);
      const { readAllActiveProjects } = await import("../../src/db/project-read.js");
      const rows = await readAllActiveProjects();
      expect(rows.length).toBeGreaterThan(0);
      const text = JSON.stringify(rows);
      for (const p of withProfile) expect(text).not.toContain(p.profile!.id);
      expect(rows.every((r) => (r as Record<string, unknown>).owner_user_id === null && (r as Record<string, unknown>).owner_tier === null)).toBe(true);
      expect(text).not.toContain("@synthetic.invalid");
    });
  });
});
