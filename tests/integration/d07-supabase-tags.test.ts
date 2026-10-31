// D07-a: the tag, suggestion and admin actions after the containment (P08 R04,
// R30). E03: their Supabase paths are gone; with no local Convex here, the
// checks that run first (session, admin, arguments) still answer, and the
// rest refuse without touching the database. The real exported server actions and route,
// called as the client calls them, against the isolated test database.
// Suggestions come from the session's viewer with their own profile email;
// only the owner attaches an existing tag, within the limit; approve and reject
// are admin-only; the admin user update writes only its four columns.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { DATA_UNAVAILABLE } from "@/backend/projects/personal";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed"); // A's: Next.js, Postgres
const fifteenTags = project("fifteenTags"); // A's, at the limit
const deletedRecent = project("deletedRecent"); // A's, soft-deleted
const pending = set.tagSubmissions[0]; // B's pending suggestion on listed

const signInAdmin = () => signInAs(admin.subject, { email: admin.profile!.email });

describe.skipIf(!testDbAvailable())("D07-a Supabase tags and moderation", () => {
  let sql: postgres.Sql;
  let subs: typeof import("../../src/app/actions/tag-submissions.js");

  const tagCount = async (projectId: string) =>
    Number((await sql`select count(*)::int n from project_tags where project_id = ${projectId}`)[0].n);
  const hasTag = async (projectId: string, name: string) =>
    (await sql`select 1 from project_tags pt join tags t on t.id = pt.tag_id
      where pt.project_id = ${projectId} and lower(t.name) = lower(${name})`).length > 0;
  const submissionsFor = async (projectId: string, tag: string) =>
    sql`select submitter_email, status from tag_submissions where project_id = ${projectId} and tag_name = ${tag}`;

  beforeAll(async () => {
    sql = await connectTestDb();
    subs = await import("../../src/app/actions/tag-submissions.js");
  });
  beforeEach(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  describe("submitNewTag", () => {
    it("signed out: refused, nothing written", async () => {
      expect(await subs.submitNewTag("rust", listed.id, A.profile!.email)).toMatchObject({ success: false });
      expect(await hasTag(listed.id, "rust")).toBe(false);
      expect(await submissionsFor(listed.id, "rust")).toHaveLength(0);
    });

    it("the owner at the limit is refused", async () => {
      signInAs(A.subject);
      expect(await subs.submitNewTag("swift", fifteenTags.id)).toMatchObject({ success: false });
      expect(await tagCount(fifteenTags.id)).toBe(15);
    });

    it("a deleted project, a malformed ID or the Better Auth switch alone: refused", async () => {
      signInAs(A.subject);
      expect(await subs.submitNewTag("rust", deletedRecent.id)).toMatchObject({ success: false });
      expect(await subs.submitNewTag("rust", "not-a-uuid")).toMatchObject({ success: false });
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("CODEDETAILS_AUTH_BACKEND", "better-auth");
      vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3390");
      vi.stubEnv("CODEDETAILS_CONVEX_SITE_URL", "http://127.0.0.1:3391");
      vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
      expect(await subs.submitNewTag("rust", listed.id)).toMatchObject({ success: false });
      expect(await hasTag(listed.id, "rust")).toBe(false);
      expect(await submissionsFor(listed.id, "rust")).toHaveLength(0);
    });

  });

  describe("approve and reject are admin-only", () => {
    // E03: moderation is Convex-only (d07-convex-tags covers the admin's
    // approval); without a local Convex even the admin is refused.
    it("approve: signed out throws, B is redirected, the admin is refused without Convex; nothing changes", async () => {
      await expect(subs.approveTagSubmission(pending.id)).rejects.toThrow(/Unauthorized/);
      signInAs(B.subject);
      await expect(subs.approveTagSubmission(pending.id)).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      await expect(subs.approveTagSubmission(pending.id)).rejects.toThrow(DATA_UNAVAILABLE);
      expect((await sql`select status from tag_submissions where id = ${pending.id}`)[0].status).toBe("pending");
      expect(await hasTag(listed.id, pending.tagName)).toBe(false);
    });

    it("reject: B is redirected; a malformed ID is refused; the admin is refused without Convex", async () => {
      signInAs(B.subject);
      await expect(subs.rejectTagSubmission(pending.id, "no")).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      expect(await subs.rejectTagSubmission("", "no")).toMatchObject({ success: false });
      await expect(subs.rejectTagSubmission(pending.id, "not a fit")).rejects.toThrow(DATA_UNAVAILABLE);
      expect((await sql`select status from tag_submissions where id = ${pending.id}`)[0].status).toBe("pending");
    });

  });

  describe("GET /api/projects/[id]/tag-submissions", () => {
    const get = async (query: string) => {
      const route = await import("../../src/app/api/projects/[id]/tag-submissions/route.js");
      return route.GET(new NextRequest(new URL(`/api/projects/${listed.id}/tag-submissions${query}`, "http://localhost:3100")), {
        params: Promise.resolve({ id: listed.id }),
      });
    };

    // E03: the suggestions come from Convex only (d07-convex-tags: the
    // viewer's own only; d09-public-access: the routes over HTTP).
    it("a bad status is refused; without Convex every read is refused, signed in or not", async () => {
      signInAs(A.subject);
      expect((await get("?status=anything")).status).toBe(400);
      const res = await get(`?status=pending&email=${encodeURIComponent(B.profile!.email)}`);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain(DATA_UNAVAILABLE);
      signInAs(null);
      expect((await get("?status=pending")).status).toBe(500);
    });
  });

  describe("admin user management", () => {
    // E03: the admin update is Convex-only (d07-convex-admin: a closed,
    // audited patch); the arguments are still checked first.
    it("updateUserAction: a non-admin is redirected, bad arguments are refused, and without Convex nothing is written", async () => {
      const um = await import("../../src/app/actions/user-management.js");
      const [{ id: profileId }] = await sql`select id from profiles where user_id = ${B.subject}`;
      signInAs(B.subject);
      await expect(um.updateUserAction(profileId, { full_name: "Hacked" })).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      await expect(um.updateUserAction("", { full_name: "x" })).rejects.toThrow(/Invalid profile ID/);
      await expect(um.updateUserAction(profileId, { tier: "platinum" })).rejects.toThrow(/Invalid tier/);
      await expect(um.updateUserAction(profileId, { full_name: "Bob Renamed" })).rejects.toThrow(DATA_UNAVAILABLE);
      const [row] = await sql`select full_name, user_id from profiles where id = ${profileId}`;
      expect(row.user_id).toBe(B.subject);
      expect(row.full_name).not.toBe("Bob Renamed");
    });

    it("checkIsSuperAdmin: signed out and B false, the admin true", async () => {
      const um = await import("../../src/app/actions/user-management.js");
      expect(await um.checkIsSuperAdmin()).toBe(false);
      signInAs(B.subject);
      expect(await um.checkIsSuperAdmin()).toBe(false);
      signInAdmin();
      expect(await um.checkIsSuperAdmin()).toBe(true);
    });

    it("fetchAdminDashboardData: the admin check runs first; without Convex the admin is refused", async () => {
      const { fetchAdminDashboardData } = await import("../../src/app/actions/admin-dashboard.js");
      await expect(fetchAdminDashboardData()).rejects.toThrow(/Unauthorized/);
      signInAs(B.subject);
      await expect(fetchAdminDashboardData()).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      await expect(fetchAdminDashboardData()).rejects.toThrow(DATA_UNAVAILABLE);
    });

    it("D07-c: the admin page checks on the server: signed out and B are redirected, the admin renders", async () => {
      const mod = await import("../../src/app/(administrator)/dashboard/admin/page.js");
      const page = (mod as unknown as { default: () => Promise<unknown> }).default;
      await expect(page()).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAs(B.subject);
      await expect(page()).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      expect(await page()).toBeTruthy();
    });

    it("the three admin action files read nothing from Clerk", () => {
      for (const file of ["admin-dashboard.ts", "user-management.ts", "advanced-analytics.ts"]) {
        expect(readFileSync(path.join(__dirname, "../../src/app/actions", file), "utf8")).not.toMatch(/@clerk\//);
      }
    });
  });
});
