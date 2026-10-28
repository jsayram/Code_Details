// B13: the P08 High findings (R02–R09, R16, R17) reproduced against synthetic
// fixtures on the isolated test database. Each test asserts what the code does
// TODAY, so it passes while the finding exists. When a D phase fixes a
// finding, its test fails; that phase turns it into the denial test
// (expected rejection) instead of deleting it.
//
// Level of evidence, per test name:
//   [action]  the real exported server action, called as the client would.
//   [handler] the real route handler, called with a NextRequest; the proxy in
//             front of it is not exercised (signed-in routes need a Clerk
//             session the isolated stack can't mint).
//   [function] an exported function below the action/route layer.
// HTTP-level checks through the proxy live in tests/e2e/b13-http.spec.ts. R02,
// R03 and R04 were also reproduced once over HTTP as signed-out server-action
// POSTs against an isolated production build (Phase B report, B13).
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkGetUser, clerkServerDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
const A = set.personas.a;
const B = set.personas.b;
const project = (c: string) => set.projects.find((p) => p.case === c)!;
const listed = project("listed");
const bobProject = project("ownedByB");
const deletedRecent = project("deletedRecent");
const fifteenTags = project("fifteenTags");

const url = (path: string) => new NextRequest(new URL(path, "http://localhost:3100"));
const body = async (res: Response) => JSON.parse(await res.text());

describe.skipIf(!testDbAvailable())("B13 High findings", () => {
  let sql: postgres.Sql;
  // Loaded lazily: src/db/server.ts throws at import when there's no test DB.
  let actions: typeof import("../../src/app/actions/projects.js");
  let dbActions: typeof import("../../src/db/actions.js");
  let tagSubmissions: typeof import("../../src/app/actions/tag-submissions.js");
  let tagActions: typeof import("../../src/app/actions/tags.js");
  let projectsRoute: typeof import("../../src/app/api/projects/route.js");
  let countsRoute: typeof import("../../src/app/api/categories/counts/route.js");
  let profilesRoute: typeof import("../../src/app/api/profiles/route.js");
  let byIdRoute: typeof import("../../src/app/api/profiles/by-id/[userId]/route.js");
  let syncUserRoute: typeof import("../../src/app/api/auth/sync-user/route.js");
  let schemas: typeof import("../../src/types/schemas/project.js");

  beforeAll(async () => {
    sql = await connectTestDb();
    actions = await import("../../src/app/actions/projects.js");
    dbActions = await import("../../src/db/actions.js");
    tagSubmissions = await import("../../src/app/actions/tag-submissions.js");
    tagActions = await import("../../src/app/actions/tags.js");
    projectsRoute = await import("../../src/app/api/projects/route.js");
    countsRoute = await import("../../src/app/api/categories/counts/route.js");
    profilesRoute = await import("../../src/app/api/profiles/route.js");
    byIdRoute = await import("../../src/app/api/profiles/by-id/[userId]/route.js");
    syncUserRoute = await import("../../src/app/api/auth/sync-user/route.js");
    schemas = await import("../../src/types/schemas/project.js");
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

  const deletedAt = async (id: string) => (await sql`select deleted_at from projects where id = ${id}`)[0].deleted_at;

  describe("R02 project and favorite actions trust a client-supplied userId", () => {
    it("[action] a signed-out caller soft-deletes A's project by passing A's subject", async () => {
      signInAs(null);
      const result = await actions.removeProject(listed.id, A.subject!);
      expect(result.success).toBe(true);
      expect(await deletedAt(listed.id)).not.toBeNull();
    });

    it("[action] B, signed in, restores A's deleted project by passing A's subject", async () => {
      signInAs(B.subject);
      const result = await actions.restoreProject(deletedRecent.id, A.subject!);
      expect(result.success).toBe(true);
      expect(await deletedAt(deletedRecent.id)).toBeNull();
    });

    it("[action] B, signed in, adds a favorite in A's name", async () => {
      signInAs(B.subject);
      expect((await actions.addProjectFavorite(project("oneTag").id, A.subject!)).success).toBe(true);
      const rows = await sql`select 1 from favorites f join profiles p on p.id = f.profile_id
        where p.user_id = ${A.subject} and f.project_id = ${project("oneTag").id}`;
      expect(rows).toHaveLength(1);
    });
  });

  describe("R03 unguarded \"use server\" write exports in src/db", () => {
    it("[function] deleteProjectServer soft-deletes any project with no identity at all", async () => {
      signInAs(null);
      await dbActions.deleteProjectServer(bobProject.id);
      expect(await deletedAt(bobProject.id)).not.toBeNull();
    });
  });

  describe("R04 tag actions have no auth or admin check", () => {
    it("[action] a signed-out caller attaches an existing tag to A's project via submitNewTag", async () => {
      const before = await sql`select count(*)::int n from project_tags where project_id = ${listed.id}`;
      const result = await tagSubmissions.submitNewTag("rust", listed.id, `b@${"synthetic.invalid"}`);
      expect(result).toMatchObject({ status: "auto_approved" });
      const after = await sql`select count(*)::int n from project_tags where project_id = ${listed.id}`;
      expect(after[0].n).toBe(before[0].n + 1);
    });

    it("[action] submitNewTag skips the 15-tag limit", async () => {
      await tagSubmissions.submitNewTag("swift", fifteenTags.id, `b@synthetic.invalid`);
      const [{ n }] = await sql`select count(*)::int n from project_tags where project_id = ${fifteenTags.id}`;
      expect(n).toBe(16);
    });

    it("[action] a signed-out caller rejects a pending submission (admin-only operation)", async () => {
      await tagSubmissions.rejectTagSubmission(set.tagSubmissions[0].id, "rejected by nobody");
      const [row] = await sql`select status from tag_submissions where id = ${set.tagSubmissions[0].id}`;
      expect(row.status).toBe("rejected");
    });

    it("[action] a signed-out caller creates a tag and attaches it to B's project", async () => {
      expect((await tagActions.addTagToProjectAction(bobProject.id, "fixture-unauthenticated")).success).toBe(true);
      const rows = await sql`select 1 from project_tags pt join tags t on t.id = pt.tag_id
        where pt.project_id = ${bobProject.id} and t.name = 'fixture-unauthenticated'`;
      expect(rows).toHaveLength(1);
    });
  });

  describe("R05 POST /api/profiles/by-id/[userId] renames any user", () => {
    it("[handler] B renames A and swaps A's avatar; no history row is written", async () => {
      signInAs(B.subject);
      const req = new Request("http://localhost:3100/api/profiles/by-id/x", {
        method: "POST",
        body: JSON.stringify({ username: "fixture-hijacked", profile_image_url: "https://evil.synthetic.invalid/x.png" }),
      });
      const res = await byIdRoute.POST(req, { params: Promise.resolve({ userId: A.subject! }) });
      expect(res.status).toBe(200);
      const [row] = await sql`select username, profile_image_url from profiles where user_id = ${A.subject}`;
      expect(row).toEqual({ username: "fixture-hijacked", profile_image_url: "https://evil.synthetic.invalid/x.png" });
      const history = await sql`select 1 from username_history where user_id = ${A.subject}`;
      expect(history).toHaveLength(0);
    });
  });

  describe("R06 /api/auth/sync-user trusts body.userId when signed out", () => {
    it("[handler] a signed-out caller makes the server look up and sync any subject", async () => {
      signInAs(null);
      clerkGetUser.mockClear();
      const req = new Request("http://localhost:3100/api/auth/sync-user", {
        method: "POST",
        body: JSON.stringify({ userId: B.subject }),
      });
      const res = await syncUserRoute.POST(req);
      // The Clerk lookup ran for the attacker-chosen subject, with no session.
      expect(clerkGetUser).toHaveBeenCalledWith(B.subject);
      // The profile write then goes to supabase-js with the service-role key.
      // The isolated stack runs no PostgREST, so that call fails, and the
      // handler still answers 200 success:true with an inner error status
      // (it swallows sync failures). The write itself is not reproduced here.
      expect(res.status).toBe(200);
      const json = await body(res);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("error");
    });

    it("[handler] without a userId in the body it does reject (control)", async () => {
      signInAs(null);
      const res = await syncUserRoute.POST(new Request("http://localhost:3100/api/auth/sync-user", { method: "POST", body: "{}" }));
      expect(res.status).toBe(401);
    });
  });

  describe("R07 email exposure", () => {
    it("[handler] GET /api/profiles returns every email with a public cache header", async () => {
      const res = await profilesRoute.GET();
      const emails = (await body(res)).data.map((p: { email_address: string }) => p.email_address);
      expect(emails).toEqual(expect.arrayContaining([A.profile!.email, B.profile!.email, set.personas.admin.profile!.email]));
      expect(res.headers.get("cache-control")).toMatch(/public/);
    });

    it("[handler] GET /api/profiles/by-id/[userId] returns the full row including email", async () => {
      const res = await byIdRoute.GET(url(`/api/profiles/by-id/${A.subject}`), { params: Promise.resolve({ userId: A.subject! }) });
      expect((await body(res)).data.profile.email_address).toBe(A.profile!.email);
    });

    it("[handler] every project list row carries the owner's email", async () => {
      const res = await projectsRoute.GET(url("/api/projects?showAll=true&limit=50"));
      const rows = (await body(res)).data as { profile: { email_address: string | null } }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.profile.email_address?.endsWith("@synthetic.invalid"))).toBe(true);
    });
  });

  describe("R08 /api/projects and /api/categories/counts take userId from the query", () => {
    it("[handler] B lists A's graveyard", async () => {
      signInAs(B.subject);
      const res = await projectsRoute.GET(url(`/api/projects?userId=${A.subject}&showDeleted=true`));
      const slugs = (await body(res)).data.map((p: { slug: string }) => p.slug).sort();
      expect(slugs).toEqual(["fixture-deleted-long-ago", "fixture-deleted-recent"]);
    });

    it("[handler] B lists A's favorites", async () => {
      signInAs(B.subject);
      const res = await projectsRoute.GET(url(`/api/projects?userId=${A.subject}&showFavorites=true`));
      const slugs = (await body(res)).data.map((p: { slug: string }) => p.slug).sort();
      expect(slugs).toEqual(expect.arrayContaining(["fixture-bob-project", "fixture-listed"]));
    });

    it("[handler] showDeleted without userId drops the deletion filter for everyone's projects", async () => {
      const res = await projectsRoute.GET(url("/api/projects?showDeleted=true&showAll=true&limit=50"));
      const slugs = (await body(res)).data.map((p: { slug: string }) => p.slug);
      expect(slugs).toEqual(expect.arrayContaining(["fixture-deleted-recent", "fixture-deleted-long-ago"]));
    });

    it("[handler] B reads A's graveyard count from /api/categories/counts", async () => {
      signInAs(B.subject);
      const res = await countsRoute.GET(url(`/api/categories/counts?userId=${A.subject}&deleted=true`));
      expect(res.status).toBe(200);
      expect(JSON.stringify(await body(res))).toMatch(/"web"\s*:\s*2/);
    });
  });

  describe("R09 project lookups trust viewer arguments and return deleted projects", () => {
    it("[function] getProjectBySlugServer shows a deleted project to whoever claims to be the owner", async () => {
      expect(await dbActions.getProjectBySlugServer(deletedRecent.slug, B.subject)).toBeNull();
      const asClaimedOwner = await dbActions.getProjectBySlugServer(deletedRecent.slug, A.subject);
      expect(asClaimedOwner?.id).toBe(deletedRecent.id);
      const asClaimedAdmin = await dbActions.getProjectBySlugServer(deletedRecent.slug, null, set.personas.admin.profile!.email);
      expect(asClaimedAdmin?.id).toBe(deletedRecent.id);
    });

    it("[action] getProjectById returns a soft-deleted project to a signed-out caller", async () => {
      const row = await actions.getProjectById(deletedRecent.id);
      expect(row?.deleted_at).not.toBeNull();
    });
  });

  describe("R16 multi-tag filter", () => {
    it("[handler] one tag works, two tags make /api/projects fail", async () => {
      const one = await projectsRoute.GET(url("/api/projects?showAll=true&tags=Postgres"));
      expect(one.status).toBe(200);
      expect((await body(one)).data.map((p: { slug: string }) => p.slug)).toContain(listed.slug);

      const two = await projectsRoute.GET(url("/api/projects?showAll=true&tags=Postgres&tags=Next.js"));
      expect(two.status).toBe(500);
    });
  });

  describe("R17 boolean query params", () => {
    it("[function] the schema coerces \"false\" to true", () => {
      const parsed = schemas.projectQuerySchema.parse({ showAll: "false", showFavorites: "false", showDeleted: "false" });
      expect(parsed).toMatchObject({ showAll: true, showFavorites: true, showDeleted: true });
    });

    it("[handler] showDeleted=false returns deleted projects", async () => {
      const res = await projectsRoute.GET(url("/api/projects?showDeleted=false&limit=50"));
      const slugs = (await body(res)).data.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain("fixture-deleted-recent");
    });
  });
});
