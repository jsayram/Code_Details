// Generator re-key, slice 2: linking a generated doc to a project, whatever
// backend the projects come from. Under both development switches projects
// live in Convex: a link's ownership is checked when it is made (the caller's
// own projects, from the session), and a non-owner reads a linked doc only
// while the page's public projection shows that exact project. The Convex
// projection has no owner ID and no function takes one, so the read side can't
// re-check ownership; these tests pin what a hand-edited meta can and can't
// do. On Supabase the D11s rule is unchanged. Sessions and project lookups are
// mocked; handlers and files are real, under .test-runtime/docs-output.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock calls below are hoisted above these imports by Vitest.
import { PATCH as linkDoc, DELETE as unlinkDoc } from "@/app/api/docs/[slug]/link-project/route";
import { GET as getChapter } from "@/app/api/docs/[slug]/[filename]/route";
import { GET as getMeta } from "@/app/api/docs/[slug]/meta/route";
import { GET as getZip } from "@/app/api/docs/[slug]/download/route";
import { GET as getLinkedDoc } from "@/app/api/projects/slug/[slug]/linked-doc/route";
import { docsOutputRoot } from "@/lib/docs-output-root";
import type { DocOwner } from "@/lib/auth-server";

type Card = { id: string; slug: string; title: string };
const state = vi.hoisted(() => ({
  owner: null as DocOwner | null,
  convex: true,
  // Convex: the caller's own active projects (projects:listMine), the page's
  // public projections by slug, and the caller's own project by slug.
  mine: [] as Card[],
  publicBySlug: {} as Record<string, { id: string; slug: string } | undefined>,
  ownBySlug: {} as Record<string, { id: string; slug: string; status: string } | undefined>,
  // Supabase
}));

vi.mock("@/lib/auth-server", () => ({
  routeDocOwner: async () => state.owner,
  viewerQueryWithArgs: async (_ref: unknown, args: { slug: string }) => ({ result: state.owner ? state.ownBySlug[args.slug] ?? null : null }),
}));
vi.mock("@/backend/projects/personal", () => ({
  personalReadsFromConvex: () => state.convex,
  convexPersonalList: async (view: string) => (view === "mine" && state.owner ? state.mine : []),
}));
vi.mock("@/backend/projects", () => ({
  getProjectReadBackend: () => ({ getPublicProjectBySlug: async (slug: string) => state.publicBySlug[slug] ?? null }),
}));

const A = "k17genrekeylinksaaaaaaaaaaaaaaaa";
const B = "k17genrekeylinksbbbbbbbbbbbbbbbb";
const C = "k17genrekeylinkscccccccccccccccc";
const CLERK_A = "user_fixture_genrekey_links_a";
const baOnly = (id: string): DocOwner => ({ writeKey: id, keys: [id] });

// Convex project IDs (shape only).
const A_PUBLIC = { id: "j97genrekeyprojectapublic0000000", slug: "genrekey-a-public", title: "A's public project" };
const A_PRIVATE = { id: "j97genrekeyprojectaprivate000000", slug: "genrekey-a-private", title: "A's private project" };
const B_PUBLIC = { id: "j97genrekeyprojectbpublic0000000", slug: "genrekey-b-public", title: "B's public project" };
const B_PRIVATE = { id: "j97genrekeyprojectbprivate000000", slug: "genrekey-b-private", title: "B's private project" };

const OUTPUT = docsOutputRoot();
const CHAPTER = "01_intro.md";
const DOCS = { a: "genrekey-links-a", aTampered: "genrekey-links-a-tampered", aTamperedPrivate: "genrekey-links-a-tampered-private" };

function writeDoc(slug: string, userId: string, extra: object = {}) {
  const dir = path.join(OUTPUT, slug);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${dir}: remove the leftover test fixture and rerun`);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { projectSlug: slug, userId, repoUrl: "https://github.com/synthetic/x", repoOwner: "synthetic", repoName: slug, createdAt: "2026-10-30T00:00:00.000Z", chapters: [{ order: 1, title: "Intro", filename: CHAPTER }], llmProvider: "synthetic", llmModel: "synthetic", ...extra };
  fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, CHAPTER), "---\ntitle: Intro\n---\n\nSynthetic chapter.\n");
}
const readMeta = (slug: string) => JSON.parse(fs.readFileSync(path.join(OUTPUT, slug, "_meta.json"), "utf8"));
const cleanup = () => Object.values(DOCS).forEach((slug) => fs.rmSync(path.join(OUTPUT, slug), { recursive: true, force: true }));
const link = (p: Card) => ({ linkedProjectId: p.id, linkedProjectSlug: p.slug, linkedProjectTitle: p.title });

const req = (init?: RequestInit) => new Request("http://localhost/api/docs", init) as never;
const p = (slug: string) => ({ params: Promise.resolve({ slug }) });
const patch = (slug: string, body: object) => linkDoc(req({ method: "PATCH", body: JSON.stringify(body) }), p(slug));
const chapter = (slug: string) => getChapter(req(), { params: Promise.resolve({ slug, filename: CHAPTER }) });
const meta = (slug: string) => getMeta(req(), p(slug));
const zip = (slug: string) => getZip(req(), p(slug));
const linkedDoc = async (projectSlug: string) => (await (await getLinkedDoc(req(), p(projectSlug))).json()).data;

beforeEach(() => {
  cleanup();
  writeDoc(DOCS.a, A);
  Object.assign(state, {
    owner: null,
    convex: true,
    mine: [],
    publicBySlug: { [A_PUBLIC.slug]: A_PUBLIC, [B_PUBLIC.slug]: B_PUBLIC },
    ownBySlug: {},
  });
});
afterAll(cleanup);

describe("generator re-key links under the Convex read switch", () => {
  it("the owner links its doc to its own project; the stored title is the project's, not the request's", async () => {
    state.owner = baOnly(A);
    state.mine = [A_PUBLIC, A_PRIVATE];
    const res = await patch(DOCS.a, { projectId: A_PUBLIC.id, projectSlug: A_PUBLIC.slug, projectTitle: "<b>Spoofed</b>" });
    expect(res.status).toBe(200);
    expect(readMeta(DOCS.a)).toMatchObject({ ...link(A_PUBLIC), userId: A });
  });

  it("linking someone else's project is refused and the doc stays unlinked", async () => {
    state.owner = baOnly(A);
    state.mine = [A_PUBLIC];
    for (const target of [B_PUBLIC, B_PRIVATE]) {
      const res = await patch(DOCS.a, { projectId: target.id, projectSlug: target.slug, projectTitle: target.title });
      expect(res.status, target.slug).toBe(404);
    }
    // Own project ID with someone else's slug, or the other way round
    expect((await patch(DOCS.a, { projectId: A_PUBLIC.id, projectSlug: B_PUBLIC.slug, projectTitle: "x" })).status).toBe(404);
    expect((await patch(DOCS.a, { projectId: B_PUBLIC.id, projectSlug: A_PUBLIC.slug, projectTitle: "x" })).status).toBe(404);
    expect(readMeta(DOCS.a).linkedProjectId).toBeUndefined();
  });

  it("someone else can't link the owner's doc, even to their own project", async () => {
    state.owner = baOnly(B);
    state.mine = [B_PUBLIC];
    expect((await patch(DOCS.a, { projectId: B_PUBLIC.id, projectSlug: B_PUBLIC.slug, projectTitle: "x" })).status).toBe(403);
    expect(readMeta(DOCS.a).linkedProjectId).toBeUndefined();
  });

  it("an invalid project ID is refused before any lookup", async () => {
    state.owner = baOnly(A);
    for (const projectId of ["../x", "A".repeat(32), "short", "j97genrekeyprojectapublic0000000/"]) {
      expect((await patch(DOCS.a, { projectId, projectSlug: A_PUBLIC.slug, projectTitle: "x" })).status, projectId).toBe(400);
    }
  });

  it("once linked to a public project, another user reads the chapters and trimmed meta, not the ZIP", async () => {
    state.owner = baOnly(A);
    state.mine = [A_PUBLIC];
    expect((await patch(DOCS.a, { projectId: A_PUBLIC.id, projectSlug: A_PUBLIC.slug, projectTitle: "x" })).status).toBe(200);
    state.owner = baOnly(B);
    expect((await chapter(DOCS.a)).status).toBe(200);
    const m = await (await meta(DOCS.a)).json();
    expect(m).toMatchObject({ isOwner: false, userId: null });
    expect(JSON.stringify(m)).not.toContain(A);
    expect((await zip(DOCS.a)).status).toBe(404);
    expect(await linkedDoc(A_PUBLIC.slug)).toMatchObject({ hasLinkedDoc: true, linkedDoc: { docSlug: DOCS.a } });
  });

  it("a doc linked to a private project, or a project whose page is gone or now has another ID, reads as missing", async () => {
    state.owner = baOnly(B);
    const cases: Array<[string, object, Record<string, { id: string; slug: string } | undefined>]> = [
      ["private project (no public projection)", link(A_PRIVATE), {}],
      ["project deleted or unlisted", link(A_PUBLIC), {}],
      ["slug now belongs to another project", link(A_PUBLIC), { [A_PUBLIC.slug]: { id: B_PUBLIC.id, slug: A_PUBLIC.slug } }],
    ];
    for (const [label, l, publics] of cases) {
      cleanup();
      writeDoc(DOCS.a, A, l);
      state.publicBySlug = publics;
      expect((await chapter(DOCS.a)).status, label).toBe(404);
      expect((await meta(DOCS.a)).status, label).toBe(404);
    }
  });

  it("the owner of a private linked project sees the linked doc on its own page; nobody else does", async () => {
    writeDoc(DOCS.aTamperedPrivate, A, link(A_PRIVATE));
    state.owner = baOnly(A);
    state.ownBySlug = { [A_PRIVATE.slug]: { id: A_PRIVATE.id, slug: A_PRIVATE.slug, status: "active" } };
    expect(await linkedDoc(A_PRIVATE.slug)).toMatchObject({ hasLinkedDoc: true });
    // projects:getOwnBySlug answers only for the project's owner
    state.owner = baOnly(B);
    state.ownBySlug = {};
    expect((await getLinkedDoc(req(), p(A_PRIVATE.slug))).status).toBe(404);
  });

  it("unlinking works for the owner and takes the doc off the project page", async () => {
    state.owner = baOnly(A);
    state.mine = [A_PUBLIC];
    expect((await patch(DOCS.a, { projectId: A_PUBLIC.id, projectSlug: A_PUBLIC.slug, projectTitle: "x" })).status).toBe(200);
    state.owner = baOnly(B);
    expect((await unlinkDoc(req(), p(DOCS.a))).status).toBe(403);
    state.owner = baOnly(A);
    expect((await unlinkDoc(req(), p(DOCS.a))).status).toBe(200);
    expect(readMeta(DOCS.a).linkedProjectId).toBeUndefined();
    state.owner = baOnly(B);
    expect((await chapter(DOCS.a)).status).toBe(404);
    expect(await linkedDoc(A_PUBLIC.slug)).toMatchObject({ hasLinkedDoc: false });
  });

  // The residual, pinned: a meta edited on disk to point A's doc at B's public
  // project makes A's doc readable to whoever can open B's public page, as a
  // linked doc is. It never makes it editable, downloadable or listed for
  // anyone but A, never shows A's key, and a private target opens nothing.
  it("a hand-edited meta pointing at another user's project grants no more than that project's public page", async () => {
    writeDoc(DOCS.aTampered, A, link(B_PUBLIC));
    writeDoc(DOCS.aTamperedPrivate, A, link(B_PRIVATE));
    for (const viewer of [B, C]) {
      state.owner = baOnly(viewer);
      // Public target: read like any linked doc, trimmed, no ZIP
      expect((await chapter(DOCS.aTampered)).status, viewer).toBe(200);
      const m = await (await meta(DOCS.aTampered)).json();
      expect(m).toMatchObject({ isOwner: false, userId: null });
      expect(JSON.stringify(m)).not.toContain(A);
      expect((await zip(DOCS.aTampered)).status, viewer).toBe(404);
      // Private target: nothing, not even for the project's owner B
      expect((await chapter(DOCS.aTamperedPrivate)).status, viewer).toBe(404);
      expect((await meta(DOCS.aTamperedPrivate)).status, viewer).toBe(404);
    }
    // B's own private project page doesn't show it either: B's project lookup is its own, the doc isn't B's
    state.owner = baOnly(B);
    state.ownBySlug = { [B_PRIVATE.slug]: { id: B_PRIVATE.id, slug: B_PRIVATE.slug, status: "active" } };
    expect((await chapter(DOCS.aTamperedPrivate)).status).toBe(404);
  });
});

describe("generator re-key links without Convex (E03: no Supabase fallback)", () => {
  it("the link is refused", async () => {
    state.convex = false;
    for (const owner of [baOnly(A), { writeKey: A, keys: [A, CLERK_A], legacyUserId: CLERK_A }]) {
      state.owner = owner;
      expect((await patch(DOCS.a, { projectId: "00000000-0000-4000-8000-0000000000a1", projectSlug: "genrekey-supabase", projectTitle: "x" })).status).toBe(404);
    }
  });

  it("the project page finds no project, so no linked doc", async () => {
    state.convex = false;
    cleanup();
    writeDoc(DOCS.a, A, { legacyUserId: CLERK_A, linkedProjectId: "00000000-0000-4000-8000-0000000000a1", linkedProjectSlug: "genrekey-supabase", linkedProjectTitle: "x" });
    expect((await getLinkedDoc(req(), p("genrekey-supabase"))).status).toBe(404);
  });
});
