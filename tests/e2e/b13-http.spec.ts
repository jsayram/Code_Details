// B13, HTTP level: requests through the real proxy and route stack of the
// isolated server, signed out (the only identity the isolated stack can
// produce over HTTP). Like tests/integration/b13-high-findings.test.ts, these
// assert today's behavior; a D phase that fixes a finding turns its test into
// the denial test.
import { generateFixtures } from "../fixtures/generate";
import { expect, test } from "./support";

const set = generateFixtures();
const A = set.personas.a;
const listed = set.projects.find((p) => p.case === "listed")!;

test.describe("B13 over HTTP, signed out", () => {
  // Was the B13 reproduction (a body userId got past the auth check). Fixed
  // in D01; D08g4f2 deleted the Clerk route, so nothing answers it any more.
  test("R06 (fixed, D01; route gone, D08g4f2): sync-user syncs nothing for a body.userId", async ({ request }) => {
    const empty = await request.post("/api/auth/sync-user", { data: {} });
    expect(empty.status()).toBe(404);
    const chosen = await request.post("/api/auth/sync-user", { data: { userId: A.subject } });
    expect(chosen.status()).toBe(404);
  });

  // Was the B13 reproduction (email and subject in the HTML); fixed for
  // signed-out visitors by the C02 public projection, so it is now the denial
  // test. Signed-in viewers still get the old read until D02r.
  test("R07 (fixed signed out, C06): the public project page carries no owner email, subject, profile ID or tier", async ({ request }) => {
    const res = await request.get(`/projects/${listed.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(listed.title);
    expect(html).toContain(A.profile!.username);
    expect(html).not.toContain(A.profile!.email);
    expect(html).not.toContain(A.subject!);
    expect(html).not.toContain(A.profile!.id);
    expect(html).not.toMatch(/owner_tier|email_address|owner_user_id/);
  });

  test("R07 not reproduced here: /api/shared-projects/[username] omits emails and subjects", async ({ request }) => {
    const res = await request.get(`/api/shared-projects/${A.profile!.username}`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(A.profile!.email);
    expect(text).not.toContain(A.subject!);
    // Side finding, fixed in D07x (DEF-D07X-SHAREDNULL): a project with no
    // tags was listed with tags ["NULL"]; now none, on Supabase and Convex.
    const noTags = JSON.parse(text).data.data.find((r: { project: { slug: string } }) => r.project.slug === "fixture-no-description");
    expect(noTags.tags).toEqual([]);
  });

  test("controls: signed-in API routes redirect signed-out requests (D-6) instead of answering 401", async ({ request }) => {
    // D08g1: the proxy answers 401 instead (D-6 fixed there).
    for (const path of [`/api/projects?userId=${A.subject}&showDeleted=true`, `/api/profiles`, `/api/categories/counts`]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(401);
    }
  });

  test("D-1: /projects/new matches the public /projects/:slug pattern and answers 200 signed out", async ({ request }) => {
    const res = await request.get("/projects/new", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });
});
