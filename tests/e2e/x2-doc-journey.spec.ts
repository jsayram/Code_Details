// X2: a generated doc's whole life through the DocStore, in the browser.
// Persona A's docs are seeded the way docs were written before X2 (one
// written by the old saveChapter/saveProjectMeta, one older doc with an
// index.md overview and chapters as plain filenames), so this also shows that
// existing docs open unchanged. Then A opens one, edits a chapter, links it to
// A's live fixture project, sees it on the project page, downloads the ZIP and
// deletes it. Synthetic data only, in the isolated server's own output root
// (.test-runtime/docs-output); the real src/app/output must not change.
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { APIRequestContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { authState, clientWithToken, convexToken, freshClientIp, linkPersona, releasePersona, signUp as fixtureSignUp, SYNTHETIC_PASSWORD, syntheticEmail, verifyEmail } from "../fixtures/better-auth";
import { generateFixtures } from "../fixtures/generate";
import { BASE_URL, expect, test } from "./support";
import { TEST_CONVEX_URL } from "../support/isolation";

const FIXTURES = generateFixtures();
const { a: A } = FIXTURES.personas;
const LISTED = FIXTURES.projects.find((p) => p.slug === "fixture-listed")!;
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT = path.join(ROOT, ".test-runtime", "docs-output");
const REAL_OUTPUT = path.join(ROOT, "src", "app", "output");
const SLUG = "x2-fixture-journey";
const OLDER = "x2-fixture-older";
const CHAPTER = "00_getting-started.md";
const getPublicBySlug = makeFunctionReference<"query", { slug: string }, { id: string } | null>("projects:getPublicBySlug");
const docOwner = makeFunctionReference<"query", Record<string, never>, { userId: string } | null>("identity:docOwner");

/** Frontmatter exactly as the pre-X2 saveChapter wrote it. */
const frontmatter = (title: string, order: number) =>
  ["---", `title: "${title}"`, `order: ${order}`, `generatedAt: "2026-11-01T00:00:00.000Z"`, "abstractionsCovered:", "---", ""].join("\n");

function realOutputListing(): string[] {
  if (!fs.existsSync(REAL_OUTPUT)) return [];
  return (fs.readdirSync(REAL_OUTPUT, { recursive: true }) as string[])
    .sort()
    .map((rel) => {
      const st = fs.statSync(path.join(REAL_OUTPUT, rel));
      return `${rel} ${st.size} ${st.mtimeMs}`;
    });
}

function seed(slug: string, files: Record<string, string>) {
  const dir = path.join(OUTPUT, slug);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${dir}: remove the leftover test fixture and rerun`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

const readMeta = (slug: string) => JSON.parse(fs.readFileSync(path.join(OUTPUT, slug, "_meta.json"), "utf8"));
const mutating = () => ({ origin: BASE_URL, "x-forwarded-for": freshClientIp() });

let realBefore: string[] = [];
let projectId = "";
let ownerKey = "";
// A Clerk-era subject left in an older doc: server-only, never in any response.
const LEGACY_SUBJECT = "user_x2legacysynthetic";

test.describe.serial("X2 doc journey through the DocStore", () => {
  test.beforeAll(async () => {
    realBefore = realOutputListing();
    projectId = (await new ConvexHttpClient(TEST_CONVEX_URL).query(getPublicBySlug, { slug: LISTED.slug }))!.id;
    await releasePersona(A.subject!);
    // Persona A's account ID, read through a throwaway linked login.
    const email = syntheticEmail("x2-account-a");
    const res = await fixtureSignUp(email, SYNTHETIC_PASSWORD);
    expect(res.status).toBe(200);
    await linkPersona(A.subject!, (await authState(email))!.authUserId);
    const owner = ownerKey = (await clientWithToken((await convexToken(res.jar))!).query(docOwner, {}))!.userId;
    await releasePersona(A.subject!);

    const base = { repoOwner: "synthetic", llmProvider: "synthetic", llmModel: "synthetic" };
    seed(SLUG, {
      "_meta.json": JSON.stringify({ projectSlug: SLUG, userId: owner, legacyUserId: LEGACY_SUBJECT, repoUrl: `https://github.com/synthetic/${SLUG}`, repoName: SLUG, ...base, createdAt: "2026-11-01T00:00:00.000Z", chapters: [{ filename: CHAPTER, title: "Getting Started", order: 0, abstractionsCovered: [] }] }, null, 2),
      "-1_overview.md": `${frontmatter("Overview", -1)}# Journey overview\n\nSynthetic overview text.\n`,
      [CHAPTER]: `${frontmatter("Getting Started", 0)}# Getting Started\n\nSynthetic first chapter.\n`,
    });
    seed(OLDER, {
      "_meta.json": JSON.stringify({ projectSlug: OLDER, userId: owner, repoUrl: `https://github.com/synthetic/${OLDER}`, repoName: OLDER, ...base, createdAt: "2026-01-01T00:00:00.000Z", chapters: ["01_intro.md"] }),
      "index.md": "# Older overview\n\nSynthetic older index.\n",
      "01_intro.md": "Synthetic older chapter without frontmatter.\n",
    });
  });

  test.afterAll(async () => {
    for (const slug of [SLUG, OLDER]) fs.rmSync(path.join(OUTPUT, slug), { recursive: true, force: true });
    await releasePersona(A.subject!);
    expect(realOutputListing(), "src/app/output changed during the X2 journey").toEqual(realBefore);
  });

  test("another signed-in user and a signed-out visitor are refused, as before X2", async ({ playwright }) => {
    const before = fs.readFileSync(path.join(OUTPUT, SLUG, CHAPTER), "utf8");
    const metaBefore = fs.readFileSync(path.join(OUTPUT, SLUG, "_meta.json"), "utf8");
    const ctx = (): Promise<APIRequestContext> => playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": freshClientIp() }, maxRedirects: 0 });

    // Signed out: the proxy answers 401 before any route runs.
    const anon = await ctx();
    for (const [method, url] of [["GET", `/api/docs/${SLUG}/${CHAPTER}`], ["GET", `/api/docs/${SLUG}/meta`], ["PUT", `/api/docs/${SLUG}/${CHAPTER}`], ["DELETE", `/api/docs/${SLUG}`]] as const) {
      expect((await anon.fetch(url, { method, data: method === "PUT" ? { content: "x" } : undefined })).status(), `${method} ${url}`).toBe(401);
    }
    await anon.dispose();

    // Another account, not A: the unlinked doc reads as missing (404) and changes are not its to make (403).
    const other = await ctx();
    const email = syntheticEmail("x2-other");
    expect((await other.post("/api/auth/sign-up/email", { data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await verifyEmail(email);
    expect((await other.post("/api/auth/sign-in/email", { data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    expect((await other.get(`/api/docs/${SLUG}/${CHAPTER}`)).status()).toBe(404);
    expect((await other.get(`/api/docs/${SLUG}/meta`)).status()).toBe(404);
    expect((await other.get(`/api/docs/${SLUG}/download`)).status()).toBe(404);
    expect((await other.put(`/api/docs/${SLUG}/${CHAPTER}`, { data: { content: "Overwritten by someone else." } })).status()).toBe(403);
    expect((await other.patch(`/api/docs/${SLUG}/link-project`, { data: { projectId, projectSlug: LISTED.slug, projectTitle: LISTED.title } })).status()).toBe(403);
    expect((await other.delete(`/api/docs/${SLUG}`)).status()).toBe(403);
    expect(JSON.stringify(await (await other.get("/api/docs")).json())).not.toContain(SLUG);
    await other.dispose();

    expect(fs.readFileSync(path.join(OUTPUT, SLUG, CHAPTER), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(OUTPUT, SLUG, "_meta.json"), "utf8")).toBe(metaBefore);
  });

  test("the owner opens, edits, links, finds on the project page, downloads and deletes a doc", async ({ page }) => {
    const email = syntheticEmail("x2-journey");
    const headers = mutating();
    expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { email, password: SYNTHETIC_PASSWORD, name: "Synthetic Person" } })).status()).toBe(200);
    await verifyEmail(email);
    expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password: SYNTHETIC_PASSWORD } })).status()).toBe(200);
    await linkPersona(A.subject!, (await authState(email))!.authUserId);

    // Listed among A's docs, newest first.
    const list = await (await page.request.get("/api/docs")).json();
    const slugs = JSON.stringify(list);
    expect(slugs.indexOf(SLUG)).toBeGreaterThan(-1);
    expect(slugs.indexOf(SLUG)).toBeLessThan(slugs.indexOf(OLDER));

    // Open: overview first, then the chapter.
    await page.goto(`/github-scrapper/docs/${SLUG}`);
    await expect(page.getByText("Synthetic overview text.")).toBeVisible();
    await page.goto(`/github-scrapper/docs/${SLUG}/${CHAPTER}`);
    await expect(page.getByText("Synthetic first chapter.")).toBeVisible();

    // Edit the chapter in the viewer; the frontmatter stays. The page reloads
    // the chapter when edit mode turns on, so wait for that before typing.
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    const reloaded = page.waitForResponse((r) => r.url().endsWith(`/api/docs/${SLUG}/${CHAPTER}`) && r.request().method() === "GET");
    await page.getByRole("button", { name: "Edit" }).click();
    await reloaded;
    const editor = page.locator("textarea");
    await expect(editor).toHaveValue(/Synthetic first chapter\./);
    await editor.fill("# Getting Started\n\nEdited in the X2 journey.\n");
    await expect(editor).toHaveValue(/Edited in the X2 journey\./);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect.poll(() => fs.readFileSync(path.join(OUTPUT, SLUG, CHAPTER), "utf8")).toContain("Edited in the X2 journey.");
    const stored = fs.readFileSync(path.join(OUTPUT, SLUG, CHAPTER), "utf8");
    expect(stored).toMatch(/^---\ntitle: Getting Started\norder: 0\n/);
    expect(await (await page.request.get(`/api/docs/${SLUG}/${CHAPTER}`)).text()).toContain("Edited in the X2 journey.");

    // Link it to A's live project; the app's fields land next to the engine's.
    const link = await page.request.patch(`/api/docs/${SLUG}/link-project`, { headers: mutating(), data: { projectId, projectSlug: LISTED.slug, projectTitle: LISTED.title } });
    expect(link.status()).toBe(200);
    expect(await link.json()).toMatchObject({ data: { linked: true, docSlug: SLUG, projectSlug: LISTED.slug } });
    expect(readMeta(SLUG)).toMatchObject({ projectSlug: SLUG, linkedProjectId: projectId, linkedProjectSlug: LISTED.slug, repoName: SLUG });

    // The project page finds it.
    await page.goto(`/projects/${LISTED.slug}`);
    const section = page.locator("#architecture-docs");
    await expect(section.getByText("Architecture Documentation")).toBeVisible();
    await expect(section.getByRole("link", { name: /Read Documentation/ })).toHaveAttribute("href", `/github-scrapper/docs/${SLUG}`);

    // Download: every Markdown file as stored, and the metadata.
    const zipRes = await page.request.get(`/api/docs/${SLUG}/download`);
    expect(zipRes.status()).toBe(200);
    expect(zipRes.headers()["content-type"]).toBe("application/zip");
    expect(zipRes.headers()["content-disposition"]).toBe(`attachment; filename="${SLUG}-docs.zip"`);
    const zip = await JSZip.loadAsync(await zipRes.body());
    expect(Object.keys(zip.files).sort()).toEqual(fs.readdirSync(path.join(OUTPUT, SLUG)).sort());
    expect(await zip.file(CHAPTER)!.async("string")).toBe(stored);
    // The ZIP's metadata is ownerMeta(): the owner's own key stays, the Clerk-era subject never leaves the server.
    const zippedMeta = await zip.file("_meta.json")!.async("string");
    expect(JSON.parse(zippedMeta)).toMatchObject({ projectSlug: SLUG, userId: ownerKey, linkedProjectSlug: LISTED.slug });
    expect(JSON.parse(zippedMeta)).not.toHaveProperty("legacyUserId");
    expect(zippedMeta).not.toContain(LEGACY_SUBJECT);
    expect(readMeta(SLUG).legacyUserId).toBe(LEGACY_SUBJECT);

    // An older doc (index.md overview, chapters as plain filenames) still opens.
    await page.goto(`/github-scrapper/docs/${OLDER}`);
    await expect(page.getByText("Synthetic older index.")).toBeVisible();

    // Delete: the folder goes, and the project page no longer finds a doc.
    const del = await page.request.delete(`/api/docs/${SLUG}`, { headers: mutating() });
    expect(del.status()).toBe(200);
    expect(await del.json()).toMatchObject({ data: { deleted: true, slug: SLUG } });
    expect(fs.existsSync(path.join(OUTPUT, SLUG))).toBe(false);
    expect((await page.request.get(`/api/docs/${SLUG}/meta`)).status()).toBe(404);
    expect(await (await page.request.get(`/api/projects/slug/${LISTED.slug}/linked-doc`)).json()).toMatchObject({ data: { hasLinkedDoc: false } });
  });
});
