// D02r: the personal reads and the signed-in project read take identity from
// the session, and signed-in viewers get no owner email or tier (P08 R07,
// R08, R09). Real handlers and actions against synthetic fixtures on the
// isolated test database; Clerk is the B13 session double. The B13 file keeps
// the denial tests for the reproduced findings; this file covers the rest.
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const listed = set.projects.find((p) => p.case === "listed")!;

const PRIVATE_KEYS = ["owner_email_address", "owner_tier", "owner_id", "email_address", "tier"];

describe.skipIf(!testDbAvailable())("D02r personal reads", () => {
  let sql: postgres.Sql;
  let slugRoute: typeof import("../../src/app/api/projects/slug/[slug]/route.js");
  let viewerRead: typeof import("../../src/backend/projects/viewer-read.js");
  let dashboard: typeof import("../../src/app/actions/user-dashboard.js");

  beforeAll(async () => {
    sql = await connectTestDb();
    slugRoute = await import("../../src/app/api/projects/slug/[slug]/route.js");
    viewerRead = await import("../../src/backend/projects/viewer-read.js");
    dashboard = await import("../../src/app/actions/user-dashboard.js");
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

  const getSlug = async (slug: string) => {
    const res = await slugRoute.GET(new NextRequest(`http://localhost:3100/api/projects/slug/${slug}`), {
      params: Promise.resolve({ slug }),
    });
    return { status: res.status, text: await res.text() };
  };

  describe("R07 for signed-in viewers", () => {
    it("/api/projects/slug/[slug]: B gets A's project without A's email, tier, profile ID or subject", async () => {
      signInAs(B.subject);
      const { status, text } = await getSlug(listed.slug);
      expect(status).toBe(200);
      const data = JSON.parse(text).data as Record<string, unknown>;
      expect(data.id).toBe(listed.id);
      expect(data.owner_username).toBe(A.profile!.username);
      for (const key of [...PRIVATE_KEYS, "user_id", "owner_user_id"]) expect(data).not.toHaveProperty(key);
      expect(text).not.toContain(A.profile!.email);
      expect(text).not.toContain(A.subject!);
    });

    it("/api/projects/slug/[slug]: the owner keeps their own user ID, still no email or tier", async () => {
      signInAs(A.subject);
      const { text } = await getSlug(listed.slug);
      const data = JSON.parse(text).data as Record<string, unknown>;
      expect(data.user_id).toBe(A.subject);
      for (const key of PRIVATE_KEYS) expect(data).not.toHaveProperty(key);
      expect(text).not.toContain(A.profile!.email);
    });

    it("the page read: owner profile scrubbed for B, user_id kept only for the owner (isOwner)", async () => {
      signInAs(B.subject);
      const asB = await viewerRead.getProjectForViewer(listed.slug);
      expect(asB?.userProfile?.username).toBe(A.profile!.username);
      for (const key of [...PRIVATE_KEYS, "id", "user_id"]) expect(asB?.userProfile).not.toHaveProperty(key);
      expect(JSON.stringify(asB)).not.toContain(A.profile!.email);
      expect(JSON.stringify(asB)).not.toContain(A.subject!);

      signInAs(A.subject);
      const asA = await viewerRead.getProjectForViewer(listed.slug);
      expect(asA?.userProfile?.user_id).toBe(A.subject);
      expect(asA?.project.user_id).toBe(A.subject);
      expect(JSON.stringify(asA)).not.toContain(A.profile!.email);
    });

    it("a missing slug is a 404 for everyone", async () => {
      signInAs(A.subject);
      expect((await getSlug("fixture-does-not-exist")).status).toBe(404);
    });
  });

  describe("dashboard", () => {
    it("the cached reader is no longer an exported server action", () => {
      expect(Object.keys(dashboard).filter((k) => k !== "default")).toEqual(["fetchUserDashboardData"]);
    });

    it("signed out, fetchUserDashboardData refuses", async () => {
      signInAs(null);
      await expect(dashboard.fetchUserDashboardData()).rejects.toThrow(/Unauthorized/);
    });

    it("signed in, it returns the session user's own stats and no user ID", async () => {
      signInAs(B.subject);
      const result = await dashboard.fetchUserDashboardData();
      expect(result).not.toHaveProperty("userId");
      expect(result.stats.myProjects.map((p) => p.slug)).toEqual(["fixture-bob-project"]);
      signInAs(A.subject);
      const own = await dashboard.fetchUserDashboardData();
      expect(own.stats.myProjects.map((p) => p.slug)).toContain(listed.slug);
      expect(own.stats.myProjects.map((p) => p.slug)).not.toContain("fixture-bob-project");
    });
  });
});
