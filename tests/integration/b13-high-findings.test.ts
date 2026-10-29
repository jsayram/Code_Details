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
    it("[action] (fixed, D03) a signed-out caller passing A's subject can't soft-delete A's project", async () => {
      signInAs(null);
      const result = await actions.removeProject(listed.id, A.subject!);
      expect(result).toMatchObject({ success: false, code: "UNAUTHORIZED" });
      expect(await deletedAt(listed.id)).toBeNull();
    });

    it("[action] (fixed, D03) B, signed in, passing A's subject can't restore A's deleted project", async () => {
      signInAs(B.subject);
      const result = await actions.restoreProject(deletedRecent.id, A.subject!);
      expect(result).toMatchObject({ success: false, code: "NOT_OWNER" });
      expect(await deletedAt(deletedRecent.id)).not.toBeNull();
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
    it("[function] (fixed, D03) deleteProjectServer is no longer a \"use server\" export", async () => {
      expect((dbActions as Record<string, unknown>).deleteProjectServer).toBeUndefined();
      expect(await deletedAt(bobProject.id)).toBeNull();
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

  // Was the B13 reproduction (a signed-out body.userId made the server look up
  // and sync any subject). Fixed in D01: identity comes only from the session.
  describe("R06 (fixed, D01) /api/auth/sync-user takes identity only from the session", () => {
    // Next still hands the handler the request; the handler no longer reads it.
    const post = (payload: unknown) =>
      (syncUserRoute.POST as (req: Request) => Promise<Response>)(new Request("http://localhost:3100/api/auth/sync-user", { method: "POST", body: JSON.stringify(payload) }));

    it("[handler] a signed-out caller naming another subject is rejected before any Clerk lookup", async () => {
      signInAs(null);
      clerkGetUser.mockClear();
      const res = await post({ userId: B.subject });
      expect(res.status).toBe(401);
      expect(clerkGetUser).not.toHaveBeenCalled();
    });

    it("[handler] a signed-in caller naming someone else still syncs only themself", async () => {
      signInAs(A.subject);
      clerkGetUser.mockClear();
      const { currentUser } = await import("@clerk/nextjs/server");
      const res = await post({ userId: B.subject });
      expect(currentUser).toHaveBeenCalled();
      expect(clerkGetUser).not.toHaveBeenCalled();
      // The isolated stack runs no PostgREST, so the profile write fails; the
      // handler now says so (500) instead of answering 200 with an inner error.
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain(B.subject!);
    });

    it("[handler] without a session or a body it rejects (control)", async () => {
      signInAs(null);
      const res = await syncUserRoute.POST();
      expect(res.status).toBe(401);
    });
  });

  describe("R07 email exposure", () => {
    // Was "GET /api/profiles returns every email with a public cache header";
    // fixed in D04a. The header stays: nothing private is left to cache.
    it("[handler] (fixed, D04a) GET /api/profiles returns no email, tier or subject", async () => {
      const res = await profilesRoute.GET();
      const text = await res.text();
      const rows = JSON.parse(text).data as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((p) => "email_address" in p || "tier" in p || "user_id" in p)).toBe(false);
      for (const email of [A.profile!.email, B.profile!.email, set.personas.admin.profile!.email]) expect(text).not.toContain(email);
      expect(text).not.toContain(A.subject!);
    });

    // Was "GET /api/profiles/by-id/[userId] returns the full row including email"; fixed in D04a.
    it("[handler] (fixed, D04a) GET /api/profiles/by-id/[userId] returns no email, tier or subject", async () => {
      const res = await byIdRoute.GET(url(`/api/profiles/by-id/${A.subject}`), { params: Promise.resolve({ userId: A.subject! }) });
      const { profile } = (await body(res)).data;
      expect(profile.username).toBe(A.profile!.username);
      expect(profile).not.toHaveProperty("email_address");
      expect(profile).not.toHaveProperty("tier");
      expect(profile).not.toHaveProperty("user_id");
    });

    // Was "every project list row carries the owner's email"; fixed in D02r.
    it("[handler] (fixed, D02r) no project list row carries an email, signed in or not", async () => {
      for (const who of [null, B.subject]) {
        signInAs(who);
        const res = await projectsRoute.GET(url("/api/projects?showAll=true&limit=50"));
        const text = await res.text();
        const rows = JSON.parse(text).data as { profile: { username: string | null; email_address: string | null } }[];
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((r) => r.profile.username)).toBe(true);
        expect(rows.every((r) => r.profile.email_address === null)).toBe(true);
        for (const email of [A.profile!.email, B.profile!.email]) expect(text).not.toContain(email);
      }
    });
  });

  // Was the B13 reproduction (B read A's graveyard, favorites and counts by
  // naming A in the query string). Fixed in D02r: identity comes only from
  // the session; the query's userId is ignored.
  describe("R08 (fixed, D02r) /api/projects and /api/categories/counts take identity from the session", () => {
    const slugs = async (res: Response) => ((await body(res)).data as { slug: string }[]).map((p) => p.slug).sort();

    it("[handler] B naming A gets B's own graveyard, not A's", async () => {
      signInAs(B.subject);
      const res = await projectsRoute.GET(url(`/api/projects?userId=${A.subject}&showDeleted=true`));
      expect(await slugs(res)).toEqual([]);
      signInAs(A.subject);
      const own = await projectsRoute.GET(url(`/api/projects?userId=${B.subject}&showDeleted=true`));
      expect(await slugs(own)).toEqual(["fixture-deleted-long-ago", "fixture-deleted-recent"]);
    });

    it("[handler] B naming A gets B's own favorites, without A's deleted project", async () => {
      signInAs(B.subject);
      const res = await projectsRoute.GET(url(`/api/projects?userId=${A.subject}&showFavorites=true`));
      // B's own favorites are fixture-listed and A's deleted fixture-deleted-recent;
      // A's favorites (fixture-bob-project) never appear.
      expect(await slugs(res)).toEqual(["fixture-listed"]);
    });

    it("[handler] B naming A in my projects gets B's own projects", async () => {
      signInAs(B.subject);
      const res = await projectsRoute.GET(url(`/api/projects?userId=${A.subject}&limit=50`));
      expect(await slugs(res)).toEqual(["fixture-bob-project"]);
    });

    it("[handler] my projects, favorites and graveyard signed out give nothing, with or without a userId", async () => {
      signInAs(null);
      for (const q of ["showDeleted=true&showAll=true&limit=50", `showDeleted=true&userId=${A.subject}`, `showFavorites=true&userId=${A.subject}`, `userId=${A.subject}`, "limit=50"]) {
        const res = await projectsRoute.GET(url(`/api/projects?${q}`));
        expect(res.status).toBe(200);
        expect(await slugs(res)).toEqual([]);
      }
    });

    it("[handler] isFavorite follows the session, not the query", async () => {
      signInAs(B.subject);
      const res = await projectsRoute.GET(url(`/api/projects?showAll=true&userId=${A.subject}&limit=50`));
      const rows = (await body(res)).data as { slug: string; isFavorite: boolean }[];
      expect(rows.find((r) => r.slug === "fixture-listed")?.isFavorite).toBe(true);
      expect(rows.find((r) => r.slug === "fixture-bob-project")?.isFavorite).toBe(false);
    });

    it("[handler] B naming A in /api/categories/counts gets B's own counts, privately cached", async () => {
      signInAs(B.subject);
      const res = await countsRoute.GET(url(`/api/categories/counts?userId=${A.subject}&deleted=true`));
      expect(res.status).toBe(200);
      expect((await body(res)).data).toEqual({});
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      signInAs(A.subject);
      const own = await countsRoute.GET(url(`/api/categories/counts?userId=${B.subject}&deleted=true`));
      expect(JSON.stringify(await body(own))).toMatch(/"web"\s*:\s*2/);
    });

    it("[handler] personal counts signed out are empty; community counts stay public", async () => {
      signInAs(null);
      const mine = await countsRoute.GET(url(`/api/categories/counts?userId=${A.subject}`));
      expect((await body(mine)).data).toEqual({});
      expect(mine.headers.get("cache-control")).toBe("private, no-store");
      const community = await countsRoute.GET(url("/api/categories/counts"));
      expect(Object.keys((await body(community)).data).length).toBeGreaterThan(0);
      expect(community.headers.get("cache-control")).toMatch(/^public/);
    });
  });

  // Was the B13 reproduction (viewer arguments were trusted, and the actions
  // returned deleted projects to anyone). Fixed in D02r.
  describe("R09 (fixed, D02r) project lookups take the viewer from the session", () => {
    it("[function] the viewer-argument lookup is no longer a \"use server\" export", async () => {
      expect("getProjectBySlugServer" in dbActions).toBe(false);
      expect("getProjectUsersProfileBySlugServer" in dbActions).toBe(false);
      expect("getUserProjectsServer" in dbActions).toBe(false);
    });

    it("[function] getProjectForViewer shows a deleted project only to the session's owner or admin", async () => {
      const { getProjectForViewer } = await import("../../src/backend/projects/viewer-read.js");
      signInAs(null);
      expect(await getProjectForViewer(deletedRecent.slug)).toBeNull();
      signInAs(B.subject);
      expect(await getProjectForViewer(deletedRecent.slug)).toBeNull();
      // The admin is recognized by the session's email claim (Clerk's rule
      // until D07), never by an argument: without the claim, no access.
      const admin = set.personas.admin;
      signInAs(admin.subject);
      expect(await getProjectForViewer(deletedRecent.slug)).toBeNull();
      signInAs(admin.subject, { email: admin.profile!.email });
      expect((await getProjectForViewer(deletedRecent.slug))?.project.id).toBe(deletedRecent.id);
      signInAs(A.subject);
      expect((await getProjectForViewer(deletedRecent.slug))?.project.id).toBe(deletedRecent.id);
    });

    it("[action] getProjectById and getProject hide a soft-deleted project from anyone but its owner", async () => {
      signInAs(null);
      expect(await actions.getProjectById(deletedRecent.id)).toBeNull();
      expect((await actions.getProject(deletedRecent.slug)).success).toBe(false);
      signInAs(B.subject);
      expect(await actions.getProjectById(deletedRecent.id)).toBeNull();
      signInAs(A.subject);
      expect((await actions.getProjectById(deletedRecent.id))?.deleted_at).not.toBeNull();
      expect((await actions.getProject(deletedRecent.slug)).success).toBe(true);
    });

    it("[handler] /api/projects?slug= hides a deleted project from a signed-out caller", async () => {
      signInAs(null);
      const res = await projectsRoute.GET(url(`/api/projects?slug=${deletedRecent.slug}`));
      expect(res.status).toBe(404);
    });

    it("[action] getUserOwnProjects lists only the session's own projects", async () => {
      signInAs(null);
      expect((await actions.getUserOwnProjects()).success).toBe(false);
      signInAs(B.subject);
      const result = await actions.getUserOwnProjects();
      expect(result.success).toBe(true);
      expect((result as { data: { slug: string }[] }).data.map((p) => p.slug)).toEqual(["fixture-bob-project"]);
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

  // Was the B13 reproduction ("false" coerced to true). Fixed in D02r.
  describe("R17 (fixed, D02r) boolean query params", () => {
    it("[function] the schema reads \"false\" as false and refuses anything but true/false", () => {
      const parsed = schemas.projectQuerySchema.parse({ showAll: "false", showFavorites: "false", showDeleted: "false" });
      expect(parsed).toMatchObject({ showAll: false, showFavorites: false, showDeleted: false });
      expect(schemas.projectQuerySchema.parse({ showAll: "true" }).showAll).toBe(true);
      expect(schemas.projectQuerySchema.parse({}).showAll).toBe(false);
      for (const bad of ["0", "1", "yes", "", "TRUE"]) {
        expect(schemas.projectQuerySchema.safeParse({ showDeleted: bad }).success).toBe(false);
      }
    });

    it("[handler] showDeleted=false returns no deleted projects; a bad flag is a 400", async () => {
      const res = await projectsRoute.GET(url("/api/projects?showAll=true&showDeleted=false&limit=50"));
      const slugs = (await body(res)).data.map((p: { slug: string }) => p.slug);
      expect(slugs).not.toContain("fixture-deleted-recent");
      expect(slugs).toContain("fixture-listed");
      const bad = await projectsRoute.GET(url("/api/projects?showDeleted=yes"));
      expect(bad.status).toBe(400);
    });
  });
});
