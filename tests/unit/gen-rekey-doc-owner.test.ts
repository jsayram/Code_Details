// Generator re-key: a generated doc belongs to whoever's own key it carries.
// New docs carry the account's Convex ID; older ones a Clerk subject; re-keyed
// ones the Convex ID plus the old subject as legacyUserId. The caller's keys
// come only from the session (routeDocOwner, mocked here in each of its
// shapes). An account with no Clerk-era login owns, lists, reads, edits and
// deletes its own docs; nobody else's key opens them; the Clerk-era subject
// never leaves the server. Route handlers and files are real, under the
// isolated output root (.test-runtime/docs-output).
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock calls below are hoisted above these imports by Vitest.
import { GET as listDocs } from "@/app/api/docs/route";
import { GET as getChapter, PUT as putChapter } from "@/app/api/docs/[slug]/[filename]/route";
import { GET as getMeta } from "@/app/api/docs/[slug]/meta/route";
import { GET as getZip } from "@/app/api/docs/[slug]/download/route";
import { DELETE as deleteDoc } from "@/app/api/docs/[slug]/route";
import { DELETE as unlinkDoc } from "@/app/api/docs/[slug]/link-project/route";
import { docsOutputRoot } from "@/lib/docs-output-root";
import type { DocOwner } from "@/lib/auth-server";

const session = vi.hoisted(() => ({ owner: null as DocOwner | null }));
const db = vi.hoisted(() => ({ project: null as null | { id: string; user_id: string }, calls: [] as unknown[][] }));

vi.mock("@/lib/auth-server", () => ({ routeDocOwner: async () => session.owner }));
// The link route's Supabase client; unlinking never queries it.
vi.mock("@/db/server", () => ({ executeQuery: async () => { throw new Error("no database in this test"); } }));
vi.mock("@/db/project-read", () => ({
  readProjectBySlug: async (...args: unknown[]) => {
    db.calls.push(args);
    return db.project;
  },
}));

// Synthetic keys: Convex-style account IDs and Clerk-style subjects.
const CONVEX_A = "k17genrekeyaccountaaaaaaaaaaaaaa";
const CONVEX_B = "k17genrekeyaccountbbbbbbbbbbbbbb";
const CLERK_A = "user_fixture_genrekey_a";
const CLERK_B = "user_fixture_genrekey_b";

// The shapes routeDocOwner returns.
const baOnly = (id: string): DocOwner => ({ writeKey: id, keys: [id] });
const baLinked = (id: string, subject: string): DocOwner => ({ writeKey: id, keys: [id, subject] });
const clerk = (subject: string): DocOwner => ({ writeKey: subject, keys: [subject] });

const OUTPUT = docsOutputRoot();
const CHAPTER = "01_intro.md";
const DOCS = {
  newA: "genrekey-unit-new-a", // written by A after the re-key: Convex ID only
  oldA: "genrekey-unit-old-a", // written by A under Clerk: Clerk subject only
  rekeyedA: "genrekey-unit-rekeyed-a", // re-keyed: Convex ID plus legacyUserId
  newB: "genrekey-unit-new-b",
  linkedA: "genrekey-unit-linked-a", // re-keyed and linked to A's Supabase project
};
const LINK = { linkedProjectId: "00000000-0000-4000-8000-0000000000a1", linkedProjectSlug: "genrekey-project", linkedProjectTitle: "Re-key" };

function writeDoc(slug: string, keys: { userId: string; legacyUserId?: string }, extra: object = {}) {
  const dir = path.join(OUTPUT, slug);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${dir}: remove the leftover test fixture and rerun`);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { projectSlug: slug, ...keys, repoUrl: "https://github.com/synthetic/x", repoOwner: "synthetic", repoName: slug, createdAt: "2026-10-30T00:00:00.000Z", chapters: [{ order: 1, title: "Intro", filename: CHAPTER }], llmProvider: "synthetic", llmModel: "synthetic", ...extra };
  fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, CHAPTER), "---\ntitle: Intro\n---\n\nSynthetic chapter.\n");
}
const cleanup = () => {
  for (const slug of Object.values(DOCS)) fs.rmSync(path.join(OUTPUT, slug), { recursive: true, force: true });
};
function writeAll() {
  cleanup();
  writeDoc(DOCS.newA, { userId: CONVEX_A });
  writeDoc(DOCS.oldA, { userId: CLERK_A });
  writeDoc(DOCS.rekeyedA, { userId: CONVEX_A, legacyUserId: CLERK_A });
  writeDoc(DOCS.newB, { userId: CONVEX_B });
  writeDoc(DOCS.linkedA, { userId: CONVEX_A, legacyUserId: CLERK_A }, LINK);
}

const req = (url = "http://localhost/api/docs", init?: RequestInit) => new Request(url, init) as never;
const p = (slug: string) => ({ params: Promise.resolve({ slug }) });
const chapter = (slug: string) => getChapter(req(), { params: Promise.resolve({ slug, filename: CHAPTER }) });
const meta = (slug: string) => getMeta(req(), p(slug));
const zip = (slug: string) => getZip(req(), p(slug));
const put = (slug: string, content = "Edited.") =>
  putChapter(req("http://localhost", { method: "PUT", body: JSON.stringify({ content }) }), { params: Promise.resolve({ slug, filename: CHAPTER }) });
const del = (slug: string) => deleteDoc(req(), p(slug));
async function listed(): Promise<string[]> {
  const res = await listDocs(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.data?.projects ?? body.projects).map((d: { slug: string }) => d.slug).sort();
}

beforeEach(() => {
  writeAll();
  session.owner = null;
  db.project = null;
  db.calls = [];
});
afterAll(cleanup);

describe("generator re-key: owner keys", () => {
  it("an account with no Clerk-era login lists, reads, edits and deletes its own new doc", async () => {
    session.owner = baOnly(CONVEX_A);
    // It also owns the re-keyed docs (their userId is its Convex ID), not the Clerk-only one.
    expect(await listed()).toEqual([DOCS.linkedA, DOCS.newA, DOCS.rekeyedA].sort());
    expect((await chapter(DOCS.newA)).status).toBe(200);
    expect(await (await meta(DOCS.newA)).json()).toMatchObject({ isOwner: true, userId: CONVEX_A });
    expect((await zip(DOCS.newA)).status).toBe(200);
    expect((await put(DOCS.newA)).status).toBe(200);
    expect(fs.readFileSync(path.join(OUTPUT, DOCS.newA, CHAPTER), "utf8")).toContain("Edited.");
    expect((await del(DOCS.newA)).status).toBe(200);
    expect(fs.existsSync(path.join(OUTPUT, DOCS.newA))).toBe(false);
  });

  it("the same account can't reach a Clerk-only doc it has no link to, or another account's doc", async () => {
    session.owner = baOnly(CONVEX_A);
    for (const slug of [DOCS.oldA, DOCS.newB]) {
      expect((await chapter(slug)).status, slug).toBe(404);
      expect((await meta(slug)).status, slug).toBe(404);
      expect((await zip(slug)).status, slug).toBe(404);
      expect((await put(slug)).status, slug).toBe(403);
      expect((await del(slug)).status, slug).toBe(403);
    }
    expect(fs.readFileSync(path.join(OUTPUT, DOCS.newB, CHAPTER), "utf8")).toContain("Synthetic chapter.");
  });

  it("a Clerk-era account under the switch owns its old, new and re-keyed docs through its own two keys", async () => {
    session.owner = baLinked(CONVEX_A, CLERK_A);
    expect(await listed()).toEqual([DOCS.linkedA, DOCS.newA, DOCS.oldA, DOCS.rekeyedA].sort());
    for (const slug of [DOCS.newA, DOCS.oldA, DOCS.rekeyedA]) {
      expect((await chapter(slug)).status, slug).toBe(200);
      expect((await put(slug)).status, slug).toBe(200);
      expect((await meta(slug)).status, slug).toBe(200);
    }
    expect((await chapter(DOCS.newB)).status).toBe(404);
  });

  // E03: legacyUserId is no longer a key. A Clerk-era subject owns only the
  // docs still keyed by it in userId (written before the re-key, never re-keyed).
  it("a Clerk-era subject no longer owns a re-keyed doc through legacyUserId", async () => {
    session.owner = clerk(CLERK_A);
    expect(await listed()).toEqual([DOCS.oldA]);
    expect((await chapter(DOCS.rekeyedA)).status).toBe(404);
    expect((await put(DOCS.rekeyedA)).status).toBe(403);
    session.owner = clerk(CLERK_B);
    expect(await listed()).toEqual([]);
    expect((await chapter(DOCS.rekeyedA)).status).toBe(404);
    expect((await put(DOCS.rekeyedA)).status).toBe(403);
    expect((await del(DOCS.rekeyedA)).status).toBe(403);
  });

  it("signed out: 401 from list, reads and writes", async () => {
    expect((await listDocs(req())).status).toBe(401);
    for (const res of [await chapter(DOCS.newA), await meta(DOCS.newA), await zip(DOCS.newA), await put(DOCS.newA), await del(DOCS.newA)]) {
      expect(res.status).toBe(401);
    }
    expect(fs.existsSync(path.join(OUTPUT, DOCS.newA))).toBe(true);
  });

  it("the Clerk-era subject (legacyUserId) never leaves the server: not in meta, the list or the ZIP", async () => {
    session.owner = baLinked(CONVEX_A, CLERK_A);
    const m = await (await meta(DOCS.rekeyedA)).json();
    expect(m).not.toHaveProperty("legacyUserId");
    expect(JSON.stringify(m)).not.toContain(CLERK_A);
    expect(JSON.stringify(await (await listDocs(req())).json())).not.toContain(CLERK_A);
    const archive = await JSZip.loadAsync(Buffer.from(await (await zip(DOCS.rekeyedA)).arrayBuffer()));
    const zipped = JSON.parse(await archive.file("_meta.json")!.async("string"));
    expect(zipped).toMatchObject({ userId: CONVEX_A, projectSlug: DOCS.rekeyedA });
    expect(JSON.stringify(zipped)).not.toContain(CLERK_A);
  });

  it("unlinking checks the owner by the same keys", async () => {
    session.owner = baOnly(CONVEX_B);
    expect((await unlinkDoc(req(), p(DOCS.linkedA))).status).toBe(403);
    session.owner = baOnly(CONVEX_A);
    expect((await unlinkDoc(req(), p(DOCS.linkedA))).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(OUTPUT, DOCS.linkedA, "_meta.json"), "utf8")).linkedProjectId).toBeUndefined();
  });
});

describe("generator re-key: linked docs", () => {
  // E03: a non-owner's read of a linked doc goes through the Convex public
  // projection only (gen-rekey-links.test.ts covers it); the Clerk-keyed
  // Supabase project lookup is gone. Without a local Convex, another user
  // reads a linked doc as missing; the owner still reads it by its account ID.
  it("without Convex another user reads a linked doc as missing; the owner reads it by its account ID", async () => {
    session.owner = baLinked(CONVEX_B, CLERK_B);
    expect((await chapter(DOCS.linkedA)).status).toBe(404);
    expect((await meta(DOCS.linkedA)).status).toBe(404);
    session.owner = baOnly(CONVEX_B);
    expect((await chapter(DOCS.linkedA)).status).toBe(404);
    session.owner = baOnly(CONVEX_A);
    expect((await chapter(DOCS.linkedA)).status).toBe(200);
    session.owner = clerk(CLERK_A);
    expect((await chapter(DOCS.linkedA)).status).toBe(404);
  });
});
