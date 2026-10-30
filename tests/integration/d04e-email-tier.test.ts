// D04e (P08 R23, R21): the profile PUT never takes an email address, the tier
// route answers only the session's own tier, and the callable reads that
// handed out other users' tiers and emails are gone or admin-checked
// (SEC-D04-DASH).
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const req = (path: string, init?: { method: string; body: string }) => new NextRequest(new URL(path, "http://localhost:3100"), init);

describe.skipIf(!testDbAvailable())("D04e email and tier (Supabase/Clerk path)", () => {
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

  describe("PUT /api/profiles/[username] (R23)", () => {
    it("refuses an email address with 400 and writes nothing, even alongside other fields", async () => {
      const route = await import("../../src/app/api/profiles/[username]/route.js");
      signInAs(A.subject);
      const res = await route.PUT(
        req("/api/profiles/fixture-alice", { method: "PUT", body: JSON.stringify({ email_address: "new@synthetic.invalid", full_name: "Changed" }) }),
        { params: Promise.resolve({ username: "fixture-alice" }) },
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/account settings/);
      const [row] = await sql`select email_address, full_name from profiles where user_id = ${A.subject}`;
      expect(row).toEqual({ email_address: A.profile!.email, full_name: "Alice Fixture" });
    });

    it("the dashboard form's own keys (email, profileImage) still don't write anything", async () => {
      const route = await import("../../src/app/api/profiles/[username]/route.js");
      signInAs(A.subject);
      const res = await route.PUT(
        req("/api/profiles/fixture-alice", { method: "PUT", body: JSON.stringify({ username: "fixture-alice", email: "x@synthetic.invalid", profileImage: "" }) }),
        { params: Promise.resolve({ username: "fixture-alice" }) },
      );
      expect(res.status).toBe(200);
      expect((await sql`select email_address from profiles where user_id = ${A.subject}`)[0].email_address).toBe(A.profile!.email);
    });
  });

  describe("GET /api/tiers/user-tier (R21)", () => {
    const tierOf = async (query = "") => {
      const route = await import("../../src/app/api/tiers/user-tier/route.js");
      return (JSON.parse(await (await route.GET(req(`/api/tiers/user-tier${query}`))).text()) as { data: { tier: string } }).data.tier;
    };

    it("signed out: free", async () => {
      expect(await tierOf()).toBe("free");
    });

    // D08g4i: the Supabase profile tier read is gone. In the app it needed a
    // Clerk-era routeViewer without Better Auth, which routeUserId never gives
    // (no login); this double faked one. With Better Auth the tier is users.tier
    // through whoami (tests/unit/d08g4i-legacy-subject.test.ts, tests/e2e/d04f-tier-display.spec.ts).
    it("without Better Auth, even a (faked) Clerk-era viewer gets free, whatever ?userId= says", async () => {
      expect(A.profile!.tier).toBe("pro");
      signInAs(A.subject);
      expect(await tierOf()).toBe("free");
      expect(await tierOf(`?userId=${A.subject}`)).toBe("free");
    });

    it("the getUserTier(userId) action module is gone", async () => {
      await expect(import("../../src/app/actions/user-tier.js" as string)).rejects.toThrow();
    });
  });

  describe("SEC-D04-DASH", () => {
    it("the unchecked dashboard actions are gone or no longer exported", async () => {
      await expect(import("../../src/app/actions/dashboard.js" as string)).rejects.toThrow();
      const adminDashboard = (await import("../../src/app/actions/admin-dashboard.js")) as Record<string, unknown>;
      expect(adminDashboard.getCachedDashboardStats).toBeUndefined();
      expect(adminDashboard.getCachedTagSubmissions).toBeUndefined();
    });

    it("getPendingTagSubmissions: signed out throws, a non-admin is redirected, the admin gets the list", async () => {
      const { getPendingTagSubmissions } = await import("../../src/app/actions/tag-submissions.js");
      await expect(getPendingTagSubmissions()).rejects.toThrow(/Unauthorized/);
      signInAs(B.subject);
      await expect(getPendingTagSubmissions()).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAs(admin.subject, { email: admin.profile!.email });
      expect(Array.isArray(await getPendingTagSubmissions())).toBe(true);
    });

    it("fetchAdminDashboardData still refuses a non-admin", async () => {
      const { fetchAdminDashboardData } = await import("../../src/app/actions/admin-dashboard.js");
      signInAs(B.subject);
      await expect(fetchAdminDashboardData()).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    });
  });
});
