// D11 (decision A): the docs and generator routes, with the development
// switch on, see a handed-over Better Auth login as its Clerk-era account, and
// refuse everyone else as signed out. Every existing check stays as it was.
// Synthetic data only: the D01 personas, real Better Auth sign-ups, and doc
// fixtures in the isolated server's own output root, .test-runtime/docs-output
// (src/lib/docs-output-root.ts; only under CODEDETAILS_ENV_ISOLATED=1). The
// real src/app/output is never written, and the file checks that its listing
// is unchanged.
// Signed-in calls send bodies the routes reject before doing any work, so
// nothing reaches GitHub or an LLM (the server's network guard refuses anyway).
import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { authState, clientWithToken, convexToken, freshClientIp, linkPersona, releasePersona, setRole, signIn as fixtureSignIn, SYNTHETIC_PASSWORD, syntheticEmail, TEST_CLIENT_IP_HEADER, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";
import { TEST_CONVEX_URL } from "../support/isolation";

const FIXTURES = generateFixtures();
const { a: A, b: B } = FIXTURES.personas;
// D11s: a live fixture project of persona A's, for a doc linked to it.
const LISTED = FIXTURES.projects.find((p) => p.slug === "fixture-listed")!;
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT = path.join(ROOT, ".test-runtime", "docs-output");
const REAL_OUTPUT = path.join(ROOT, "src", "app", "output");
const CHAPTER = "01_intro.md";
const DOCS = { mine: "d11-fixture-mine", mine2: "d11-fixture-mine-two", theirs: "d11-fixture-theirs", linked: "d11s-fixture-linked", fresh: "genrekey-fixture-fresh", fresh2: "genrekey-fixture-fresh-two", convexLink: "genrekey-fixture-convex-link" };
const getPublicBySlug = makeFunctionReference<"query", { slug: string }, { id: string } | null>("projects:getPublicBySlug");
const docOwner = makeFunctionReference<"query", Record<string, never>, { userId: string; legacySubject: string | null } | null>("identity:docOwner");

/** The account ID a Better Auth login's docs are keyed by, read in its own second session. */
async function accountIdOf(email: string, legacySubject: string | null = null): Promise<string> {
  const session = await fixtureSignIn(email, SYNTHETIC_PASSWORD);
  expect(session.status).toBe(200);
  const owner = await clientWithToken((await convexToken(session.jar))!).query(docOwner, {});
  expect(owner?.legacySubject ?? null).toBe(legacySubject);
  return owner!.userId;
}

/** Names, sizes and modification times of everything under the real output root. */
function realOutputListing(): string[] {
  if (!fs.existsSync(REAL_OUTPUT)) return [];
  return (fs.readdirSync(REAL_OUTPUT, { recursive: true }) as string[])
    .sort()
    .map((rel) => {
      const st = fs.statSync(path.join(REAL_OUTPUT, rel));
      return `${rel} ${st.size} ${st.mtimeMs}`;
    });
}

/** Writes a fixture doc; refuses if it already exists, so nothing is ever overwritten. */
function writeDoc(slug: string, userId: string, extra: object = {}) {
  const dir = path.join(OUTPUT, slug);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${dir}: remove the leftover test fixture and rerun`);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { projectSlug: slug, userId, repoUrl: `https://github.com/synthetic/${slug}`, repoOwner: "synthetic", repoName: slug, createdAt: "2026-10-29T00:00:00.000Z", chapters: [{ order: 1, title: "Intro", filename: CHAPTER }], llmProvider: "synthetic", llmModel: "synthetic", ...extra };
  fs.writeFileSync(path.join(OUTPUT, slug, "_meta.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(OUTPUT, slug, CHAPTER), "---\ntitle: Intro\norder: 1\n---\n\nSynthetic chapter.\n");
}
const removeDocs = () => Object.values(DOCS).forEach((slug) => fs.rmSync(path.join(OUTPUT, slug), { recursive: true, force: true }));

// The real output root (Jose's generated docs in his checkout) must look exactly the same afterwards.
let realBefore: string[] = [];
test.beforeAll(() => {
  realBefore = realOutputListing();
});
test.afterAll(() => {
  expect(realOutputListing(), "src/app/output changed during the D11 tests").toEqual(realBefore);
});

async function client(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, [TEST_CLIENT_IP_HEADER]: freshClientIp() }, maxRedirects: 0 });
}
async function signIn(ctx: APIRequestContext, label: string, headers: Record<string, string> = {}): Promise<string> {
  const email = syntheticEmail(label);
  expect((await ctx.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
  await verifyEmail(email);
  expect((await ctx.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
  return email;
}

/** Each route, with a body it rejects as invalid once past the identity check. */
const ROUTES: Array<{ name: string; call: (c: APIRequestContext) => Promise<import("@playwright/test").APIResponse> }> = [
  { name: "GET /api/docs", call: (c) => c.get("/api/docs") },
  { name: "DELETE /api/docs/[slug]", call: (c) => c.delete(`/api/docs/${DOCS.theirs}`) },
  { name: "PUT /api/docs/[slug]/[filename]", call: (c) => c.put(`/api/docs/${DOCS.theirs}/${CHAPTER}`, { data: {} }) },
  { name: "PATCH /api/docs/[slug]/link-project", call: (c) => c.patch(`/api/docs/${DOCS.theirs}/link-project`, { data: {} }) },
  { name: "DELETE /api/docs/[slug]/link-project", call: (c) => c.delete(`/api/docs/${DOCS.theirs}/link-project`) },
  // D11s: the doc reads now check identity themselves too
  { name: "GET /api/docs/[slug]/[filename]", call: (c) => c.get(`/api/docs/${DOCS.theirs}/${CHAPTER}`) },
  { name: "GET /api/docs/[slug]/meta", call: (c) => c.get(`/api/docs/${DOCS.theirs}/meta`) },
  { name: "GET /api/docs/[slug]/download", call: (c) => c.get(`/api/docs/${DOCS.theirs}/download`) },
  { name: "POST /api/generate-docs", call: (c) => c.post("/api/generate-docs", { data: {} }) },
  { name: "POST /api/llm", call: (c) => c.post("/api/llm", { data: {} }) },
  { name: "POST /api/llm-test", call: (c) => c.post("/api/llm-test", { data: {} }) },
  { name: "POST /api/repo/analyze", call: (c) => c.post("/api/repo/analyze", { data: {} }) },
  { name: "POST /api/repo/crawl", call: (c) => c.post("/api/repo/crawl", { data: {} }) },
];
// D08 gate: the routes that reach a model provider; admins only.
const MODEL_ROUTES = ["POST /api/generate-docs", "POST /api/llm", "POST /api/llm-test"];

test.describe("D11 generator routes, signed out (either switch state)", () => {
  test.beforeAll(() => writeDoc(DOCS.theirs, B.subject!));
  test.afterAll(removeDocs);

  for (const r of ROUTES) {
    test(`${r.name}: refused as today`, async ({ playwright }) => {
      const ctx = await client(playwright);
      const res = await r.call(ctx);
      // The D08g1 proxy answers 401; the route never runs.
      expect(res.status()).toBe(401);
      await ctx.dispose();
    });
  }
});

test.describe.serial("D11 generator routes, signed in (switch on)", () => {
  // D08h: global setup loads the D01 personas in Better Auth mode, so a missing
  // persona is a failure (releasePersona throws), never a silent skip.
  let persona: APIRequestContext;
  let unlinked: APIRequestContext;
  let unlinkedId = "";
  let personaEmail = "";

  test.beforeAll(async ({ playwright }) => {
    writeDoc(DOCS.mine, A.subject!);
    writeDoc(DOCS.mine2, A.subject!);
    writeDoc(DOCS.theirs, B.subject!);
    // Independent of test order and earlier runs: persona A starts with no Better Auth link.
    await releasePersona(A.subject!);
    // A Better Auth login on Clerk-era persona A (the end state the removed D08d handover left).
    persona = await client(playwright);
    personaEmail = await signIn(persona, "d11-persona");
    await linkPersona(A.subject!, (await authState(personaEmail))!.authUserId);
    unlinked = await client(playwright);
    unlinkedId = await accountIdOf(await signIn(unlinked, "d11-unlinked"));
    // Generator re-key: docs written for an account with no Clerk-era login, keyed by its account ID.
    writeDoc(DOCS.fresh, unlinkedId);
    writeDoc(DOCS.fresh2, unlinkedId);
  });
  test.afterAll(async () => {
    removeDocs();
    // Leave persona A as the fixtures loaded it, for any later spec.
    await releasePersona(A.subject!);
    await persona?.dispose();
    await unlinked?.dispose();
  });

  test("generator re-key: an account with no Clerk-era link lists, reads, edits and deletes its own docs", async () => {
    const list = await unlinked.get("/api/docs");
    expect(list.status()).toBe(200);
    const listed = JSON.stringify(await list.json());
    expect(listed).toContain(DOCS.fresh);
    expect(listed).toContain(DOCS.fresh2);
    for (const other of [DOCS.mine, DOCS.mine2, DOCS.theirs]) expect(listed).not.toContain(other);
    const ch = await unlinked.get(`/api/docs/${DOCS.fresh}/${CHAPTER}`);
    expect(ch.status()).toBe(200);
    expect(await ch.text()).toContain("Synthetic chapter.");
    const meta = await (await unlinked.get(`/api/docs/${DOCS.fresh}/meta`)).json();
    expect(meta).toMatchObject({ isOwner: true, userId: unlinkedId });
    expect(meta).not.toHaveProperty("legacyUserId");
    expect((await unlinked.get(`/api/docs/${DOCS.fresh}/download`)).status()).toBe(200);
    expect((await unlinked.put(`/api/docs/${DOCS.fresh}/${CHAPTER}`, { data: { content: "Edited by its owner." } })).status()).toBe(200);
    expect(fs.readFileSync(path.join(OUTPUT, DOCS.fresh, CHAPTER), "utf8")).toContain("Edited by its owner.");
    expect((await unlinked.delete(`/api/docs/${DOCS.fresh2}`)).status()).toBe(200);
    expect(fs.existsSync(path.join(OUTPUT, DOCS.fresh2))).toBe(false);
  });

  test("generator re-key: that account still can't reach anyone else's doc", async () => {
    for (const slug of [DOCS.mine, DOCS.theirs]) {
      expect((await unlinked.get(`/api/docs/${slug}/${CHAPTER}`)).status(), slug).toBe(404);
      expect((await unlinked.get(`/api/docs/${slug}/meta`)).status(), slug).toBe(404);
      expect((await unlinked.get(`/api/docs/${slug}/download`)).status(), slug).toBe(404);
      expect((await unlinked.put(`/api/docs/${slug}/${CHAPTER}`, { data: { content: "x" } })).status(), slug).toBe(403);
      expect((await unlinked.delete(`/api/docs/${slug}`)).status(), slug).toBe(403);
      expect((await unlinked.delete(`/api/docs/${slug}/link-project`)).status(), slug).toBe(403);
    }
    expect(fs.readFileSync(path.join(OUTPUT, DOCS.mine, CHAPTER), "utf8")).toContain("Synthetic chapter.");
    // And A's login can't reach this account's doc.
    expect((await persona.get(`/api/docs/${DOCS.fresh}/${CHAPTER}`)).status()).toBe(404);
  });

  test("generator re-key: the generator routes let that account past the identity check (invalid bodies, nothing sent out)", async () => {
    for (const name of ["POST /api/repo/analyze", "POST /api/repo/crawl"]) {
      const r = ROUTES.find((x) => x.name === name)!;
      expect((await r.call(unlinked)).status(), name).toBe(400);
    }
    // D08 /api/llm gate (and llm-gate-2): the model routes are admins only, so
    // this (non-admin) account stops at 403.
    for (const name of MODEL_ROUTES) expect((await ROUTES.find((x) => x.name === name)!.call(unlinked)).status(), name).toBe(403);
  });

  test("D11s: the owner reads its own chapter, metadata and ZIP", async () => {
    const ch = await persona.get(`/api/docs/${DOCS.mine}/${CHAPTER}`);
    expect(ch.status()).toBe(200);
    expect(await ch.text()).toContain("Synthetic chapter.");
    expect((await persona.get(`/api/docs/${DOCS.mine}/meta`)).status()).toBe(200);
    expect((await persona.get(`/api/docs/${DOCS.mine}/download`)).status()).toBe(200);
  });

  test("D11s: someone else's unlinked doc reads exactly like a missing one (404)", async () => {
    const missing = await persona.get(`/api/docs/d11-fixture-missing/${CHAPTER}`);
    const theirs = await persona.get(`/api/docs/${DOCS.theirs}/${CHAPTER}`);
    expect(theirs.status()).toBe(404);
    expect(await theirs.text()).toBe(await missing.text());
    expect((await persona.get(`/api/docs/${DOCS.theirs}/meta`)).status()).toBe(404);
    expect((await persona.get(`/api/docs/${DOCS.theirs}/download`)).status()).toBe(404);
    // A userId in the query string changes nothing: identity comes from the session.
    expect((await persona.get(`/api/docs/${DOCS.theirs}/${CHAPTER}?userId=${B.subject}`)).status()).toBe(404);
  });

  test("D11s: encoded traversal never leaves the output root", async () => {
    for (const url of [`/api/docs/%2E%2E/${CHAPTER}`, `/api/docs/${DOCS.mine}/..%2F${DOCS.theirs}%2F${CHAPTER}`, `/api/docs/${DOCS.mine}/..%2F_meta.json`, `/api/docs/%2E%2E/meta`, `/api/docs/%2E%2E/download`]) {
      const res = await persona.get(url);
      expect([400, 404], url).toContain(res.status());
      expect(await res.text(), url).not.toContain("Synthetic chapter.");
    }
  });

  test("the handed-over login lists only its own docs", async () => {
    const res = await persona.get("/api/docs");
    expect(res.status()).toBe(200);
    const slugs = JSON.stringify(await res.json());
    expect(slugs).toContain(DOCS.mine);
    expect(slugs).toContain(DOCS.mine2);
    expect(slugs).not.toContain(DOCS.theirs);
  });

  test("owner checks: someone else's doc is refused and left alone", async () => {
    expect((await persona.delete(`/api/docs/${DOCS.theirs}`)).status()).toBe(403);
    expect((await persona.put(`/api/docs/${DOCS.theirs}/${CHAPTER}`, { data: { content: "x" } })).status()).toBe(403);
    expect((await persona.patch(`/api/docs/${DOCS.theirs}/link-project`, { data: {} })).status()).toBe(403);
    expect((await persona.delete(`/api/docs/${DOCS.theirs}/link-project`)).status()).toBe(403);
    expect(fs.existsSync(path.join(OUTPUT, DOCS.theirs, "_meta.json"))).toBe(true);
    expect(fs.readFileSync(path.join(OUTPUT, DOCS.theirs, CHAPTER), "utf8")).toContain("Synthetic chapter.");
  });

  test("owner checks: its own doc gets past them", async () => {
    // Invalid bodies: the routes' own validation answers, after the owner check.
    expect((await persona.put(`/api/docs/${DOCS.mine}/${CHAPTER}`, { data: {} })).status()).toBe(400);
    expect((await persona.patch(`/api/docs/${DOCS.mine}/link-project`, { data: {} })).status()).toBe(400);
    const del = await persona.delete(`/api/docs/${DOCS.mine2}`);
    expect(del.status()).toBe(200);
    expect(fs.existsSync(path.join(OUTPUT, DOCS.mine2))).toBe(false);
  });

  test("the generator routes get past the identity check (invalid bodies, nothing sent out)", async () => {
    for (const name of ["POST /api/repo/analyze", "POST /api/repo/crawl"]) {
      const r = ROUTES.find((x) => x.name === name)!;
      expect((await r.call(persona)).status(), name).toBe(400);
    }
    // D08 /api/llm gate (and llm-gate-2): a non-admin stops at 403; made an
    // admin, the same invalid body reaches the route's own validation (400)
    // before any unit of the daily cap is taken or a provider is called.
    for (const name of MODEL_ROUTES) expect((await ROUTES.find((x) => x.name === name)!.call(persona)).status(), name).toBe(403);
    const authUserId = (await authState(personaEmail))!.authUserId;
    await setRole(authUserId, "admin");
    try {
      for (const name of MODEL_ROUTES) expect((await ROUTES.find((x) => x.name === name)!.call(persona)).status(), name).toBe(400);
    } finally {
      await setRole(authUserId, "user");
    }
  });
});

// D11s (option B): a doc linked to the owner's live project is readable by
// another signed-in user on the viewer page, with trimmed metadata, and the
// "Download All" button shows only for the owner (the ZIP is owner-only).
// Each test signs in fresh; personas are released before and after the block.
test.describe.serial("D11s linked doc on the viewer page (switch on)", () => {
  const CHAPTER_URL = `/github-scrapper/docs/${DOCS.linked}/${CHAPTER}`;

  test.beforeAll(async () => {
    // Generator re-key: under both switches projects live in Convex, so a link carries the Convex project ID.
    const linkedProjectId = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex"
      ? (await new ConvexHttpClient(TEST_CONVEX_URL).query(getPublicBySlug, { slug: LISTED.slug }))!.id
      : LISTED.id;
    writeDoc(DOCS.linked, A.subject!, { linkedProjectId, linkedProjectSlug: LISTED.slug, linkedProjectTitle: LISTED.title });
    await releasePersona(A.subject!);
    await releasePersona(B.subject!);
  });
  test.afterAll(async () => {
    fs.rmSync(path.join(OUTPUT, DOCS.linked), { recursive: true, force: true });
    await releasePersona(A.subject!);
    await releasePersona(B.subject!);
  });

  /** Signs this page's browser in as a fresh Better Auth login on Clerk-era persona `subject`. */
  async function signInPageAs(page: import("@playwright/test").Page, label: string, subject: string) {
    const email = await signIn(page.request, label, { origin: BASE_URL, "x-forwarded-for": freshClientIp() });
    await linkPersona(subject, (await authState(email))!.authUserId);
  }

  test("the owner sees the chapter and the Download All button", async ({ page }) => {
    await signInPageAs(page, "d11s-owner", A.subject!);
    expect(await (await page.request.get(`/api/docs/${DOCS.linked}/meta`)).json()).toMatchObject({ userId: A.subject, isOwner: true });
    await page.goto(CHAPTER_URL);
    await expect(page.getByText("Synthetic chapter.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download All" })).toBeVisible();
    // Generator re-key: the edit controls follow the server's isOwner, so the owner has them under the switch too.
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  });

  test("another user reads the linked chapter with trimmed metadata, sees no Download All, and the ZIP is refused", async ({ page }) => {
    await signInPageAs(page, "d11s-other", B.subject!);
    const meta = await (await page.request.get(`/api/docs/${DOCS.linked}/meta`)).json();
    expect(meta).toMatchObject({ userId: null, isOwner: false });
    expect(JSON.stringify(meta)).not.toContain(A.subject!);
    expect((await page.request.get(`/api/docs/${DOCS.linked}/${CHAPTER}`)).status()).toBe(200);
    expect((await page.request.get(`/api/docs/${DOCS.linked}/download`)).status()).toBe(404);
    await page.goto(CHAPTER_URL);
    await expect(page.getByText("Synthetic chapter.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download All" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });
});

// Generator re-key, slice 2: under both switches projects live in Convex. The
// owner links its doc (keyed by its account ID) to its own Convex project; the
// link is checked against the owner's own projects when it is made, and
// another user reads it while that project's public page shows it.
test.describe.serial("generator re-key: linking to a Convex project (both switches)", () => {
  test.skip(process.env.CODEDETAILS_E2E_READ_BACKEND !== "convex", "needs CODEDETAILS_E2E_READ_BACKEND=convex");
  const PRIVATE = FIXTURES.projects.find((p) => p.slug === "fixture-private")!;
  const BOBS = FIXTURES.projects.find((p) => p.slug === "fixture-bob-project")!;
  let owner: APIRequestContext;
  let other: APIRequestContext;
  let ownerEmail = "";
  const projectIds: Record<string, string> = {};

  test.beforeAll(async ({ playwright }) => {
    await releasePersona(A.subject!);
    await releasePersona(B.subject!);
    owner = await client(playwright);
    ownerEmail = await signIn(owner, "genrekey-link-owner");
    await linkPersona(A.subject!, (await authState(ownerEmail))!.authUserId);
    other = await client(playwright);
    const otherEmail = await signIn(other, "genrekey-link-other");
    await linkPersona(B.subject!, (await authState(otherEmail))!.authUserId);
    // A new doc of A's, keyed by A's account ID as the generator now writes it
    writeDoc(DOCS.convexLink, await accountIdOf(ownerEmail, A.subject!), { legacyUserId: A.subject });
    // Convex project IDs, as the link picker and the community list see them
    for (const row of (await (await owner.get("/api/projects?limit=100")).json()).data) projectIds[row.slug] = row.id;
    for (const row of (await (await other.get("/api/projects?limit=100")).json()).data) projectIds[row.slug] = row.id;
    expect(projectIds[LISTED.slug] && projectIds[PRIVATE.slug] && projectIds[BOBS.slug]).toBeTruthy();
  });
  test.afterAll(async () => {
    fs.rmSync(path.join(OUTPUT, DOCS.convexLink), { recursive: true, force: true });
    await releasePersona(A.subject!);
    await releasePersona(B.subject!);
    await owner?.dispose();
    await other?.dispose();
  });

  const linkTo = (ctx: APIRequestContext, slug: string) =>
    ctx.patch(`/api/docs/${DOCS.convexLink}/link-project`, { data: { projectId: projectIds[slug], projectSlug: slug, projectTitle: "Spoofed title" } });

  test("linking someone else's project is refused, and someone else can't link the owner's doc", async () => {
    expect((await linkTo(owner, BOBS.slug)).status()).toBe(404);
    expect((await linkTo(other, BOBS.slug)).status()).toBe(403);
    expect(JSON.parse(fs.readFileSync(path.join(OUTPUT, DOCS.convexLink, "_meta.json"), "utf8")).linkedProjectId).toBeUndefined();
  });

  test("a doc linked to the owner's private project stays the owner's", async () => {
    expect((await linkTo(owner, PRIVATE.slug)).status()).toBe(200);
    expect((await other.get(`/api/docs/${DOCS.convexLink}/${CHAPTER}`)).status()).toBe(404);
    expect((await owner.get(`/api/docs/${DOCS.convexLink}/${CHAPTER}`)).status()).toBe(200);
  });

  test("linked to the owner's public project, another user reads it with trimmed meta and no ZIP", async () => {
    const res = await linkTo(owner, LISTED.slug);
    expect(res.status()).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(OUTPUT, DOCS.convexLink, "_meta.json"), "utf8"))).toMatchObject({
      linkedProjectId: projectIds[LISTED.slug],
      linkedProjectSlug: LISTED.slug,
      linkedProjectTitle: LISTED.title,
    });
    expect((await other.get(`/api/docs/${DOCS.convexLink}/${CHAPTER}`)).status()).toBe(200);
    const meta = await (await other.get(`/api/docs/${DOCS.convexLink}/meta`)).json();
    expect(meta).toMatchObject({ isOwner: false, userId: null });
    expect(JSON.stringify(meta)).not.toContain(A.subject!);
    expect((await other.get(`/api/docs/${DOCS.convexLink}/download`)).status()).toBe(404);
    const linked = await (await other.get(`/api/projects/slug/${LISTED.slug}/linked-doc`)).json();
    expect(linked.data).toMatchObject({ hasLinkedDoc: true, linkedDoc: { docSlug: DOCS.convexLink } });
  });

  test("the owner's my-docs page lists the linked doc under the Better Auth session", async ({ page }) => {
    // The owner's own session, in the browser
    await page.context().addCookies((await owner.storageState()).cookies);
    await page.goto("/github-scrapper/my-docs");
    await expect(page.getByText(DOCS.convexLink).first()).toBeVisible();
  });

  test("unlinking takes it away from everyone else", async () => {
    expect((await owner.delete(`/api/docs/${DOCS.convexLink}/link-project`)).status()).toBe(200);
    expect((await other.get(`/api/docs/${DOCS.convexLink}/${CHAPTER}`)).status()).toBe(404);
    const linked = await (await other.get(`/api/projects/slug/${LISTED.slug}/linked-doc`)).json();
    expect(linked.data).toMatchObject({ hasLinkedDoc: false });
  });
});
