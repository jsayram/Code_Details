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
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
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
      // D08g4f2: the Supabase restore is gone, so it refuses everyone.
      expect(result).toMatchObject({ success: false });
      expect(await deletedAt(deletedRecent.id)).not.toBeNull();
    });

    it("[action] (fixed, D05) B, signed in, can't add a favorite in A's name", async () => {
      signInAs(B.subject);
      // D08g4f2: the Supabase favorite is gone, so it refuses everyone.
      expect((await actions.addProjectFavorite(project("oneTag").id, A.subject!)).success).toBe(false);
      const rows = await sql`select 1 from favorites f join profiles p on p.id = f.profile_id
        where p.user_id = ${A.subject} and f.project_id = ${project("oneTag").id}`;
      expect(rows).toHaveLength(0);
    });
  });

  describe("R03 unguarded \"use server\" write exports in src/db", () => {
    it("[function] (fixed, D03) deleteProjectServer is no longer a \"use server\" export", async () => {
      expect((dbActions as Record<string, unknown>).deleteProjectServer).toBeUndefined();
      expect(await deletedAt(bobProject.id)).toBeNull();
    });
  });

  // Fixed in D07-a; the full cases are in d07-supabase-tags.test.ts.
  describe("R04 (fixed, D07) tag actions check the caller", () => {
    it("[action] (fixed, D07) a signed-out caller can't attach an existing tag to A's project via submitNewTag", async () => {
      const before = await sql`select count(*)::int n from project_tags where project_id = ${listed.id}`;
      const result = await tagSubmissions.submitNewTag("rust", listed.id, `b@${"synthetic.invalid"}`);
      expect(result).toMatchObject({ success: false });
      const after = await sql`select count(*)::int n from project_tags where project_id = ${listed.id}`;
      expect(after[0].n).toBe(before[0].n);
    });

    it("[action] (fixed, D07) submitNewTag keeps the 15-tag limit, even for the owner", async () => {
      signInAs(A.subject);
      expect(await tagSubmissions.submitNewTag("swift", fifteenTags.id, `b@synthetic.invalid`)).toMatchObject({ success: false });
      const [{ n }] = await sql`select count(*)::int n from project_tags where project_id = ${fifteenTags.id}`;
      expect(n).toBe(15);
    });

    it("[action] (fixed, D07) a signed-out caller can't reject a pending submission", async () => {
      await expect(tagSubmissions.rejectTagSubmission(set.tagSubmissions[0].id, "rejected by nobody")).rejects.toThrow(/Unauthorized/);
      const [row] = await sql`select status from tag_submissions where id = ${set.tagSubmissions[0].id}`;
      expect(row.status).toBe("pending");
    });

    it("[action] (fixed, D07) the unguarded tag writers are no longer exported", async () => {
      expect((tagActions as Record<string, unknown>).addTagToProjectAction).toBeUndefined();
      const rows = await sql`select 1 from project_tags pt join tags t on t.id = pt.tag_id
        where pt.project_id = ${bobProject.id} and t.name = 'fixture-unauthenticated'`;
      expect(rows).toHaveLength(0);
    });
  });

  // Was "B renames A and swaps A's avatar; no history row is written"; fixed
  // in D04b by removing the handler; E03 removed the whole route
  // (tests/unit/e03-dead-routes.test.ts checks it has no file and no caller).
  describe("R05 (fixed, D04b; route gone at E03) POST /api/profiles/by-id/[userId] is gone", () => {
    it("[handler] the route module is gone, and A's profile is untouched", async () => {
      await expect(import("../../src/app/api/profiles/by-id/[userId]/route.js" as string)).rejects.toThrow();
      const [row] = await sql`select username from profiles where user_id = ${A.subject}`;
      expect(row.username).toBe(A.profile!.username);
    });
  });

  // R06 (sync-user) moved out: D08g4f2 deleted the route; tests/e2e/b13-http.spec.ts checks it answers 404.
  describe("R07 email exposure", () => {
    // Was "GET /api/profiles returns every email with a public cache header"
    // (fixed in D04a) and "every project list row carries the owner's email"
    // (fixed in D02r). E03: both routes read Convex only (no email in
    // d04a-convex-public-profile listPublic, d07x-convex-public-lists and
    // d02r-convex-personal-reads rows). Without a local Convex they refuse
    // and carry no fixture data at all.
    it("[handler] (E03) without Convex the directory and the project list refuse, with no email or subject", async () => {
      for (const who of [null, B.subject]) {
        signInAs(who);
        for (const res of [await profilesRoute.GET(), await projectsRoute.GET(url("/api/projects?showAll=true&limit=50"))]) {
          expect(res.status).toBe(500);
          const text = await res.text();
          for (const email of [A.profile!.email, B.profile!.email, set.personas.admin.profile!.email]) expect(text).not.toContain(email);
          expect(text).not.toContain(A.subject!);
          expect(text).not.toContain("fixture-");
        }
      }
    });
  });

  // Was the B13 reproduction (B read A's graveyard, favorites and counts by
  // naming A in the query string). Fixed in D02r: identity comes only from
  // the session; the query's userId is ignored.
  describe("R08 (fixed, D02r) /api/projects and /api/categories/counts take identity from the session", () => {
    // E03: B naming A in the query (graveyard, favorites, my projects,
    // isFavorite, counts) was checked here on Supabase. The Convex reads take
    // no identity argument at all: d02r-convex-personal-reads (each caller's
    // own rows and counts) and tests/unit/d01-no-identity-args.test.ts.

    // D09 S02c: /api/projects became a public route, so a signed-out personal
    // view is refused outright (401) instead of answering an empty list.
    it("[handler] my projects, favorites and graveyard signed out are a 401, with or without a userId", async () => {
      signInAs(null);
      for (const q of ["showDeleted=true&showAll=true&limit=50", `showDeleted=true&userId=${A.subject}`, `showFavorites=true&userId=${A.subject}`, `userId=${A.subject}`, "limit=50"]) {
        const res = await projectsRoute.GET(url(`/api/projects?${q}`));
        expect(res.status, q).toBe(401);
        expect(JSON.stringify(await body(res))).not.toContain("fixture-");
      }
    });

    // D09 S02c: the counts route is public now; a signed-out personal count is
    // a 401 (checked before the backend). E03: the community counts are
    // Convex-only (d09-public-access), so without Convex they refuse.
    it("[handler] personal counts signed out are a 401; without Convex the community counts refuse", async () => {
      signInAs(null);
      const mine = await countsRoute.GET(url(`/api/categories/counts?userId=${A.subject}`));
      expect(mine.status).toBe(401);
      expect(JSON.stringify(await body(mine))).not.toMatch(/"web"/);
      const community = await countsRoute.GET(url("/api/categories/counts"));
      expect(community.status).toBe(500);
      expect(JSON.stringify(await body(community))).not.toMatch(/"web"/);
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

    // E03: getProjectForViewer, getProjectById, getProject, getUserOwnProjects
    // and the Supabase /api/projects?slug= read are gone. The deleted-project
    // rule on Convex: c10-convex-public-read (the public projection hides it)
    // and d03-convex-project-lifecycle (the owner's own read);
    // tests/unit/e03-supabase-fallback.test.ts checks the actions stay gone.
  });

  // Was the B13 reproduction (two tags made the route 500). Fixed in D07x;
  // E03: the list is Convex-only, and d07x-convex-public-lists filters by
  // one and by two tags.

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

    // E03: the list itself is Convex-only; the flag is parsed before that.
    it("[handler] a bad flag is a 400", async () => {
      const bad = await projectsRoute.GET(url("/api/projects?showDeleted=yes"));
      expect(bad.status).toBe(400);
    });
  });
});
