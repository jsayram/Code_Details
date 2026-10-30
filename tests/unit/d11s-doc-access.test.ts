// D11s (option B): a generated doc's chapters and metadata are readable by its
// owner, and by other signed-in users only while it is linked to a project of
// the owner's that the viewer can open on the project page (readProjectBySlug,
// the page's own rule). Non-owners get a trimmed metadata view; the ZIP is
// owner-only. Every refusal is the same 404 as a missing doc; signed out is 401.
// Slugs and filenames that could leave the output root, or be stripped into
// another doc's name, are refused. The session and the project lookup are
// mocked; the route handlers and the files are real, under the isolated output
// root (.test-runtime/docs-output).
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock calls below are hoisted above these imports by Vitest.
import { GET as getChapter, PUT as putChapter } from "@/app/api/docs/[slug]/[filename]/route";
import { GET as getMeta } from "@/app/api/docs/[slug]/meta/route";
import { GET as getZip } from "@/app/api/docs/[slug]/download/route";
import { DELETE as deleteDoc } from "@/app/api/docs/[slug]/route";
import { docDir, docsOutputRoot, isSafeChapterFilename, isSafeDocSlug } from "@/lib/docs-output-root";

const viewer = vi.hoisted(() => ({ userId: null as string | null, isAdmin: false }));
// What readProjectBySlug returns for the linked slug: the page's own visibility
// rule already applied (null for a missing project, or a soft-deleted one the viewer can't see).
const db = vi.hoisted(() => ({ project: null as null | { id: string; user_id: string }, calls: [] as unknown[][], fail: false }));

// routeDocOwner as it answers with Clerk (the default): one key, Clerk's userId.
vi.mock("@/lib/auth-server", () => ({
  routeDocOwner: async () =>
    viewer.userId
      ? { writeKey: viewer.userId, keys: [viewer.userId], legacyUserId: null, projectViewer: { userId: viewer.userId, isAdmin: viewer.isAdmin } }
      : null,
}));
vi.mock("@/db/project-read", () => ({
  readProjectBySlug: async (...args: unknown[]) => {
    db.calls.push(args);
    if (db.fail) throw new Error("database down");
    return db.project;
  },
}));

const OWNER = "user_fixture_d11s_owner";
const OTHER = "user_fixture_d11s_other";
const OUTPUT = docsOutputRoot();
const CHAPTER = "01_intro.md";
const DOCS = { mine: "d11s-unit-mine", linked: "d11s-unit-linked" };
const CANARY = "d11s-unit-canary.md";
const LINK = { linkedProjectId: "00000000-0000-4000-8000-000000000001", linkedProjectSlug: "d11s-project", linkedProjectTitle: "D11s" };

function writeDoc(slug: string, extra: object = {}) {
  const dir = path.join(OUTPUT, slug);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${dir}: remove the leftover test fixture and rerun`);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { projectSlug: slug, userId: OWNER, repoUrl: "https://github.com/synthetic/x", repoOwner: "synthetic", repoName: slug, createdAt: "2026-10-29T00:00:00.000Z", chapters: [{ order: 1, title: "Intro", filename: CHAPTER }], llmProvider: "synthetic", llmModel: "synthetic", ...extra };
  fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, CHAPTER), "---\ntitle: Intro\n---\n\nSynthetic chapter.\n");
}
const cleanup = () => {
  for (const slug of Object.values(DOCS)) fs.rmSync(path.join(OUTPUT, slug), { recursive: true, force: true });
  fs.rmSync(path.join(OUTPUT, CANARY), { force: true });
};

const req = (url = "http://localhost/api/docs") => new Request(url) as never;
const chapter = (slug: string, filename = CHAPTER) => getChapter(req(), { params: Promise.resolve({ slug, filename }) });
const meta = (slug: string) => getMeta(req(), { params: Promise.resolve({ slug }) });
const zip = (slug: string) => getZip(req(), { params: Promise.resolve({ slug }) });

beforeAll(() => {
  cleanup();
  writeDoc(DOCS.mine);
  writeDoc(DOCS.linked, LINK);
  // Outside any doc's directory: a traversal that reaches it would return this text.
  fs.writeFileSync(path.join(OUTPUT, CANARY), "CANARY outside the doc\n");
});
afterAll(cleanup);
beforeEach(() => {
  viewer.userId = null;
  viewer.isAdmin = false;
  db.project = null;
  db.calls = [];
  db.fail = false;
});
const LIVE_PROJECT = { id: LINK.linkedProjectId, user_id: OWNER };

describe("D11s doc reads: who may read", () => {
  it("signed out: 401 from every read of a linked or unlinked doc, nothing looked up", async () => {
    db.project = LIVE_PROJECT;
    for (const slug of [DOCS.mine, DOCS.linked]) {
      for (const res of [await chapter(slug), await meta(slug), await zip(slug)]) expect(res.status, slug).toBe(401);
    }
    expect(db.calls).toHaveLength(0);
  });

  it("the owner reads chapter, full metadata and ZIP of linked and unlinked docs, without a project lookup", async () => {
    viewer.userId = OWNER;
    for (const slug of [DOCS.mine, DOCS.linked]) {
      const ch = await chapter(slug);
      expect(ch.status).toBe(200);
      expect(await ch.text()).toContain("Synthetic chapter.");
      const m = await meta(slug);
      expect(m.status).toBe(200);
      expect(await m.json()).toMatchObject({ userId: OWNER, isOwner: true, repoName: slug });
      const z = await zip(slug);
      expect(z.status).toBe(200);
      expect(z.headers.get("content-type")).toBe("application/zip");
    }
    expect(db.calls).toHaveLength(0);
  });

  it("another user: an unlinked doc reads exactly like a missing one, and the project table isn't consulted", async () => {
    viewer.userId = OTHER;
    const missing = await chapter("d11s-unit-does-not-exist");
    const theirs = await chapter(DOCS.mine);
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    const missingMeta = await meta("d11s-unit-does-not-exist");
    const theirMeta = await meta(DOCS.mine);
    expect(theirMeta.status).toBe(404);
    expect(await theirMeta.json()).toEqual(await missingMeta.json());
    expect((await zip(DOCS.mine)).status).toBe(404);
    expect(db.calls).toHaveLength(0);
  });

  it("another user reads the chapters of a doc linked to a project they can open, checked with their own session", async () => {
    viewer.userId = OTHER;
    viewer.isAdmin = false;
    db.project = LIVE_PROJECT;
    const ch = await chapter(DOCS.linked);
    expect(ch.status).toBe(200);
    expect(await ch.text()).toContain("Synthetic chapter.");
    expect(db.calls[0]).toEqual([LINK.linkedProjectSlug, { userId: OTHER, isAdmin: false }]);
  });

  it("another user gets only the page's metadata fields: no owner ID, cost, tokens or link fields", async () => {
    viewer.userId = OTHER;
    db.project = LIVE_PROJECT;
    const res = await meta(DOCS.linked);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      projectSlug: DOCS.linked,
      userId: null,
      isOwner: false,
      repoUrl: "https://github.com/synthetic/x",
      createdAt: "2026-10-29T00:00:00.000Z",
      chapters: [{ filename: CHAPTER, title: "Intro", order: 1 }],
      llmProvider: "synthetic",
      llmModel: "synthetic",
    });
    expect(JSON.stringify(body)).not.toContain(OWNER);
  });

  it("the ZIP stays owner-only even for a linked doc", async () => {
    viewer.userId = OTHER;
    db.project = LIVE_PROJECT;
    const res = await zip(DOCS.linked);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(await (await zip("d11s-unit-does-not-exist")).json());
  });

  it("a link to a project the viewer can't open (gone, soft-deleted), re-pointed or someone else's, or a failed lookup, reads as missing", async () => {
    viewer.userId = OTHER;
    const cases: Array<[string, typeof db.project]> = [
      ["not visible to this viewer", null],
      ["link points at another project id", { id: "00000000-0000-4000-8000-0000000000ff", user_id: OWNER }],
      ["project belongs to someone else", { id: LINK.linkedProjectId, user_id: OTHER }],
    ];
    for (const [label, project] of cases) {
      db.project = project;
      expect((await chapter(DOCS.linked)).status, label).toBe(404);
      expect((await meta(DOCS.linked)).status, label).toBe(404);
    }
    db.project = LIVE_PROJECT;
    db.fail = true;
    expect((await chapter(DOCS.linked)).status).toBe(404);
    expect((await meta(DOCS.linked)).status).toBe(404);
  });

  it("identity comes from the session, not the query string", async () => {
    viewer.userId = OTHER;
    const res = await getChapter(req(`http://localhost/api/docs/${DOCS.mine}/${CHAPTER}?userId=${OWNER}`), { params: Promise.resolve({ slug: DOCS.mine, filename: CHAPTER }) });
    expect(res.status).toBe(404);
  });
});

describe("D11s doc reads: path traversal", () => {
  const badSlugs = ["..", ".", "../d11s-unit-mine", "d11s-unit-mine/..", "%2e%2e", "a/b", "a\\b", "d11s-unit-mi.ne", "", "x".repeat(256)];
  const badFiles = [`../${CANARY}`, `..%2F${CANARY}`, "../d11s-unit-mine/01_intro.md", "_meta.json", ".hidden.md", "01_intro.md/..", "a/b.md", "..md", "01_intro.txt", "01_in tro.md"];

  it("unsafe slugs and filenames are refused, even for the owner, and never reach the canary", async () => {
    viewer.userId = OWNER;
    for (const slug of badSlugs) {
      for (const res of [await chapter(slug), await meta(slug), await zip(slug)]) {
        expect(res.status, slug).toBe(404);
        expect(await res.text()).not.toContain("CANARY");
      }
    }
    for (const filename of badFiles) {
      const res = await chapter(DOCS.mine, filename);
      expect(res.status, filename).toBe(404);
      expect(await res.text()).not.toContain("CANARY");
    }
  });

  it("an unsafe name is refused, not stripped into another doc's name (the old behaviour)", async () => {
    viewer.userId = OWNER;
    // Stripping used to turn this into d11s-unit-mine.
    expect((await chapter("d11s-unit-mi.ne")).status).toBe(404);
    expect((await chapter(DOCS.mine, "01_in!tro.md")).status).toBe(404);
  });

  it("the write and delete routes refuse traversal too and leave everything in place", async () => {
    viewer.userId = OWNER;
    const put = await putChapter(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ content: "x" }) }) as never, { params: Promise.resolve({ slug: DOCS.mine, filename: `../${CANARY}` }) });
    expect(put.status).toBe(404);
    const del = await deleteDoc(req(), { params: Promise.resolve({ slug: ".." }) });
    expect(del.status).toBe(404);
    expect(fs.readFileSync(path.join(OUTPUT, CANARY), "utf8")).toContain("CANARY");
    expect(fs.existsSync(path.join(OUTPUT, DOCS.mine, CHAPTER))).toBe(true);
  });

  it("the validators and docDir agree", () => {
    for (const s of badSlugs) expect(isSafeDocSlug(s), s).toBe(false);
    for (const f of badFiles) expect(isSafeChapterFilename(f), f).toBe(false);
    expect(isSafeDocSlug("octo-repo-20261029-abc123")).toBe(true);
    expect(isSafeChapterFilename("-1_overview.md")).toBe(true);
    expect(isSafeChapterFilename("03_the-parser.md")).toBe(true);
    expect(() => docDir("..", "/root")).toThrow();
    expect(docDir("ok-slug", "/root")).toBe(path.join("/root", "ok-slug"));
  });
});
