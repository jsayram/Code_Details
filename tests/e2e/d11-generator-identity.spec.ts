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
import { SYNTHETIC_PASSWORD, authState, freshClientIp, linkPersona, releasePersona, syntheticEmail, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";

const betterAuth = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth";
const FIXTURES = generateFixtures();
const { a: A, b: B } = FIXTURES.personas;
// D11s: a live fixture project of persona A's, for a doc linked to it.
const LISTED = FIXTURES.projects.find((p) => p.slug === "fixture-listed")!;
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT = path.join(ROOT, ".test-runtime", "docs-output");
const REAL_OUTPUT = path.join(ROOT, "src", "app", "output");
const CHAPTER = "01_intro.md";
const DOCS = { mine: "d11-fixture-mine", mine2: "d11-fixture-mine-two", theirs: "d11-fixture-theirs", linked: "d11s-fixture-linked" };

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
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": freshClientIp() }, maxRedirects: 0 });
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

test.describe("D11 generator routes, signed out (either switch state)", () => {
  test.beforeAll(() => writeDoc(DOCS.theirs, B.subject!));
  test.afterAll(removeDocs);

  for (const r of ROUTES) {
    test(`${r.name}: refused as today`, async ({ playwright }) => {
      const ctx = await client(playwright);
      const res = await r.call(ctx);
      // The D08g1 proxy answers 401. Clerk's protect redirects signed-out API calls (B13 D-6),
      // but answers 404 instead for some requests it doesn't treat as page loads (seen on a
      // cold server's first request). Either way the route never runs; its own refusal is 401.
      if (betterAuth) expect(res.status()).toBe(401);
      else expect([307, 404]).toContain(res.status());
      await ctx.dispose();
    });
  }
});

test.describe.serial("D11 generator routes, signed in (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");
  // D08h: global setup loads the D01 personas in Better Auth mode, so a missing
  // persona is a failure (releasePersona throws), never a silent skip.
  let persona: APIRequestContext;
  let unlinked: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    writeDoc(DOCS.mine, A.subject!);
    writeDoc(DOCS.mine2, A.subject!);
    writeDoc(DOCS.theirs, B.subject!);
    // Independent of test order and earlier runs: persona A starts with no Better Auth link.
    await releasePersona(A.subject!);
    // A Better Auth login on Clerk-era persona A (the end state the removed D08d handover left).
    persona = await client(playwright);
    const email = await signIn(persona, "d11-persona");
    await linkPersona(A.subject!, (await authState(email))!.authUserId);
    unlinked = await client(playwright);
    await signIn(unlinked, "d11-unlinked");
  });
  test.afterAll(async () => {
    removeDocs();
    // Leave persona A as the fixtures loaded it, for any later spec.
    await releasePersona(A.subject!);
    await persona?.dispose();
    await unlinked?.dispose();
  });

  test("an account with no Clerk-era link is refused by every route, as if signed out", async () => {
    for (const r of ROUTES) expect((await r.call(unlinked)).status(), r.name).toBe(401);
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
    for (const name of ["POST /api/generate-docs", "POST /api/llm", "POST /api/llm-test", "POST /api/repo/analyze", "POST /api/repo/crawl"]) {
      const r = ROUTES.find((x) => x.name === name)!;
      expect((await r.call(persona)).status(), name).toBe(400);
    }
  });
});

// D11s (option B): a doc linked to the owner's live project is readable by
// another signed-in user on the viewer page, with trimmed metadata, and the
// "Download All" button shows only for the owner (the ZIP is owner-only).
// Each test signs in fresh; personas are released before and after the block.
test.describe.serial("D11s linked doc on the viewer page (switch on)", () => {
  test.skip(!betterAuth, "needs CODEDETAILS_E2E_AUTH_BACKEND=better-auth");
  const CHAPTER_URL = `/github-scrapper/docs/${DOCS.linked}/${CHAPTER}`;

  test.beforeAll(async () => {
    writeDoc(DOCS.linked, A.subject!, { linkedProjectId: LISTED.id, linkedProjectSlug: LISTED.slug, linkedProjectTitle: LISTED.title });
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
  });
});
