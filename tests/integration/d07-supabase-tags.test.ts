// D07-a: the default (Clerk + Supabase) tag, suggestion and admin actions after
// the containment (P08 R04, R30). The real exported server actions and route,
// called as the client calls them, against the isolated test database.
// Suggestions come from the session's viewer with their own profile email;
// only the owner attaches an existing tag, within the limit; approve and reject
// are admin-only; the admin user update writes only its four columns.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
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

    it("a non-owner's suggestion of an existing tag stays pending, under their own email whatever they pass", async () => {
      signInAs(B.subject);
      const result = await subs.submitNewTag("rust", listed.id, A.profile!.email);
      expect(result).toMatchObject({ status: "pending" });
      expect(await hasTag(listed.id, "rust")).toBe(false);
      const rows = await submissionsFor(listed.id, "rust");
      expect(rows).toEqual([{ submitter_email: B.profile!.email, status: "pending" }]);
    });

    it("the owner attaches an existing tag directly", async () => {
      signInAs(A.subject);
      expect(await subs.submitNewTag("rust", listed.id, "ignored@synthetic.invalid")).toMatchObject({ status: "auto_approved" });
      expect(await hasTag(listed.id, "rust")).toBe(true);
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

    it("a second pending suggestion of the same tag from the same viewer is refused", async () => {
      signInAs(B.subject);
      await subs.submitNewTag("fixture-new-idea", listed.id);
      await expect(subs.submitNewTag("fixture-new-idea", listed.id)).rejects.toThrow(/pending/);
    });
  });

  describe("approve and reject are admin-only", () => {
    it("approve: signed out throws, B is redirected, the admin's approval attaches the tag", async () => {
      await expect(subs.approveTagSubmission(pending.id)).rejects.toThrow(/Unauthorized/);
      signInAs(B.subject);
      await expect(subs.approveTagSubmission(pending.id)).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      expect((await sql`select status from tag_submissions where id = ${pending.id}`)[0].status).toBe("pending");
      expect(await hasTag(listed.id, pending.tagName)).toBe(false);
      signInAdmin();
      await subs.approveTagSubmission(pending.id);
      expect((await sql`select status from tag_submissions where id = ${pending.id}`)[0].status).toBe("approved");
      expect(await hasTag(listed.id, pending.tagName)).toBe(true);
    });

    it("reject: B is redirected; the admin rejects; a malformed ID is refused", async () => {
      signInAs(B.subject);
      await expect(subs.rejectTagSubmission(pending.id, "no")).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      expect(await subs.rejectTagSubmission("not-a-uuid", "no")).toMatchObject({ success: false });
      expect((await sql`select status from tag_submissions where id = ${pending.id}`)[0].status).toBe("pending");
      await subs.rejectTagSubmission(pending.id, "not a fit");
      const [row] = await sql`select status, admin_notes from tag_submissions where id = ${pending.id}`;
      expect(row).toMatchObject({ status: "rejected", admin_notes: "not a fit" });
    });

    it("an approved non-owner suggestion of an existing tag attaches it (the review path)", async () => {
      signInAs(B.subject);
      await subs.submitNewTag("rust", listed.id);
      const [{ id }] = await sql`select id from tag_submissions where project_id = ${listed.id} and tag_name = 'rust'`;
      signInAdmin();
      await subs.approveTagSubmission(id);
      expect(await hasTag(listed.id, "rust")).toBe(true);
    });
  });

  describe("approveRejectedTagSubmission", () => {
    const rejectRow = async (email: string) =>
      sql`insert into tag_submissions (tag_name, project_id, submitter_email, status)
        values ('fixture-was-rejected', ${listed.id}, ${email}, 'rejected')`;
    const statusOf = async (email: string) =>
      (await sql`select status from tag_submissions where tag_name = 'fixture-was-rejected' and submitter_email = ${email}`)[0].status;

    it("only the project's owner flips only their own rejected suggestion", async () => {
      await rejectRow(A.profile!.email);
      await rejectRow(B.profile!.email);
      await subs.approveRejectedTagSubmission(listed.id, "fixture-was-rejected", A.profile!.email);
      expect(await statusOf(A.profile!.email)).toBe("rejected");
      signInAs(B.subject);
      await subs.approveRejectedTagSubmission(listed.id, "fixture-was-rejected", B.profile!.email);
      expect(await statusOf(B.profile!.email)).toBe("rejected");
      signInAs(A.subject);
      await subs.approveRejectedTagSubmission(listed.id, "fixture-was-rejected", B.profile!.email);
      expect(await statusOf(A.profile!.email)).toBe("approved");
      expect(await statusOf(B.profile!.email)).toBe("rejected");
    });
  });

  describe("GET /api/projects/[id]/tag-submissions", () => {
    const get = async (query: string) => {
      const route = await import("../../src/app/api/projects/[id]/tag-submissions/route.js");
      return route.GET(new NextRequest(new URL(`/api/projects/${listed.id}/tag-submissions${query}`, "http://localhost:3100")), {
        params: Promise.resolve({ id: listed.id }),
      });
    };

    it("signed out is refused; a bad status is refused", async () => {
      expect((await get(`?email=${encodeURIComponent(B.profile!.email)}`)).status).toBe(401);
      signInAs(A.subject);
      expect((await get("?status=anything")).status).toBe(400);
    });

    it("A naming B's email gets only A's own suggestions; B gets B's", async () => {
      signInAs(A.subject);
      const asA = JSON.parse(await (await get(`?status=pending&email=${encodeURIComponent(B.profile!.email)}`)).text());
      expect(asA.data).toEqual([]);
      signInAs(B.subject);
      const asB = JSON.parse(await (await get(`?status=pending&email=x@synthetic.invalid`)).text());
      expect(asB.data.map((r: { id: string }) => r.id)).toEqual([pending.id]);
    });
  });

  describe("admin user management", () => {
    it("updateUserAction writes only its four columns; a non-admin is redirected", async () => {
      const um = await import("../../src/app/actions/user-management.js");
      const [{ id: profileId }] = await sql`select id from profiles where user_id = ${B.subject}`;
      signInAs(B.subject);
      await expect(um.updateUserAction(profileId, { full_name: "Hacked" })).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
      signInAdmin();
      await um.updateUserAction(profileId, { full_name: "Bob Renamed", user_id: A.subject } as never);
      const [row] = await sql`select full_name, user_id from profiles where id = ${profileId}`;
      expect(row).toEqual({ full_name: "Bob Renamed", user_id: B.subject });
      await expect(um.updateUserAction("not-a-uuid", { full_name: "x" })).rejects.toThrow(/Invalid profile ID/);
      await expect(um.updateUserAction(profileId, { tier: "platinum" })).rejects.toThrow(/Invalid tier/);
    });

    it("checkIsSuperAdmin: signed out and B false, the admin true", async () => {
      const um = await import("../../src/app/actions/user-management.js");
      expect(await um.checkIsSuperAdmin()).toBe(false);
      signInAs(B.subject);
      expect(await um.checkIsSuperAdmin()).toBe(false);
      signInAdmin();
      expect(await um.checkIsSuperAdmin()).toBe(true);
    });

    it("fetchAdminDashboardData gives the admin the pending list from outside the session check", async () => {
      const { fetchAdminDashboardData } = await import("../../src/app/actions/admin-dashboard.js");
      signInAdmin();
      const { submissions } = await fetchAdminDashboardData();
      expect(submissions.flatMap((g) => g.submissions.map((s) => s.id))).toContain(pending.id);
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
