// X2: the engine's on-disk DocStore. Same layout as before X2 (one folder per
// doc slug, _meta.json plus NN_title.md chapters with YAML frontmatter), the
// same D11s name checks, and fields the app keeps in the metadata (owner key,
// linked project) pass through untouched. Runs against a temp directory.
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileDocStore, docDir } from "@/repoScrapper/store/file-doc-store";
import { createChapterFilename, isSafeChapterFilename, isSafeDocSlug, type DocMeta } from "@/repoScrapper/store/doc-store";

type AppMeta = DocMeta & { userId: string; linkedProjectId?: string; linkedProjectSlug?: string; linkedProjectTitle?: string };

const SLUG = "octo-repo-20261110-abc123";
const engineMeta = (createdAt = "2026-11-10T12:00:00.000Z"): Omit<AppMeta, "projectSlug"> => ({
  userId: "owner-key-1",
  repoUrl: "https://github.com/octo/repo",
  repoOwner: "octo",
  repoName: "repo",
  createdAt,
  chapters: [{ filename: "00_intro.md", title: "Intro", order: 0, abstractionsCovered: [] }],
  llmProvider: "openai",
  llmModel: "gpt-synthetic",
});

let root: string;
let store: FileDocStore<AppMeta>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "x2-docstore-"));
  store = new FileDocStore<AppMeta>(path.join(root, "output"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const outside = () => path.join(root, "outside");

describe("FileDocStore round trip", () => {
  it("saves chapters and metadata in today's layout and reads them back", async () => {
    const filename = await store.saveChapter(SLUG, { order: 0, title: 'Chapter 1: The "Core"', content: "# Hello\n", abstractionsCovered: ["A"] });
    expect(filename).toBe("00_chapter-1-the-core.md");
    expect(await store.saveChapter(SLUG, { order: -1, title: "Overview", content: "index", abstractionsCovered: [] })).toBe("-1_overview.md");
    await store.saveMeta(SLUG, engineMeta());

    expect((await fs.readdir(path.join(store.root, SLUG))).sort()).toEqual(["-1_overview.md", "00_chapter-1-the-core.md", "_meta.json"]);

    const raw = await store.readChapter(SLUG, filename);
    expect(raw).toMatch(/^---\ntitle: "Chapter 1: The \\"Core\\""\norder: 0\ngeneratedAt: "[^"]+"\nabstractionsCovered:\n {2}- "A"\n---\n# Hello\n$/);

    const onDisk = await fs.readFile(path.join(store.root, SLUG, "_meta.json"), "utf-8");
    expect(onDisk).toBe(JSON.stringify({ projectSlug: SLUG, ...engineMeta() }, null, 2));
    expect(await store.readMeta(SLUG)).toEqual({ projectSlug: SLUG, ...engineMeta() });
  });

  it("uses the same chapter names as the flow's index links", () => {
    expect(createChapterFilename(3, "Chapter 4: File Upload & Parsing!")).toBe("03_chapter-4-file-upload-parsing.md");
    expect(createChapterFilename(-1, "Overview")).toBe("-1_overview.md");
  });

  it("opens a doc written before X2 unchanged, app fields included", async () => {
    const dir = path.join(store.root, "legacy-doc");
    await fs.mkdir(dir, { recursive: true });
    const legacy = { projectSlug: "legacy-doc", ...engineMeta(), legacyUserId: "user_clerk", linkedProjectId: "p1", linkedProjectSlug: "proj", linkedProjectTitle: "Proj", chapters: ["00_a.md"] };
    await fs.writeFile(path.join(dir, "_meta.json"), JSON.stringify(legacy, null, 2));
    await fs.writeFile(path.join(dir, "index.md"), "old overview");
    expect(await store.readMeta("legacy-doc")).toEqual(legacy);
    expect(await store.readChapter("legacy-doc", "index.md")).toBe("old overview");
    expect(await store.readChapter("legacy-doc", "-1_overview.md")).toBeNull();
  });

  it("merges metadata updates, keeps the slug, and clears fields set to undefined", async () => {
    await store.saveMeta(SLUG, engineMeta());
    const linked = await store.updateMeta(SLUG, { linkedProjectId: "p1", linkedProjectSlug: "proj", linkedProjectTitle: "Proj", projectSlug: "other" });
    expect(linked).toMatchObject({ projectSlug: SLUG, userId: "owner-key-1", linkedProjectSlug: "proj" });
    const unlinked = await store.updateMeta(SLUG, { linkedProjectId: undefined, linkedProjectSlug: undefined, linkedProjectTitle: undefined });
    const onDisk = JSON.parse(await fs.readFile(path.join(store.root, SLUG, "_meta.json"), "utf-8"));
    expect(onDisk).toEqual({ projectSlug: SLUG, ...engineMeta() });
    expect(unlinked?.linkedProjectSlug).toBeUndefined();
    expect(await store.updateMeta("missing-doc", { linkedProjectId: "p1" })).toBeNull();
  });

  it("replaces only an existing chapter", async () => {
    const filename = await store.saveChapter(SLUG, { order: 0, title: "Intro", content: "v1", abstractionsCovered: [] });
    expect(await store.writeChapter(SLUG, filename, "v2")).toBe(true);
    expect(await store.readChapter(SLUG, filename)).toBe("v2");
    expect(await store.writeChapter(SLUG, "01_new.md", "x")).toBe(false);
    await expect(fs.access(path.join(store.root, SLUG, "01_new.md"))).rejects.toThrow();
  });
});

describe("FileDocStore list and delete", () => {
  it("lists docs newest first, creating the root, skipping dot folders and folders without metadata", async () => {
    expect(await store.listDocs()).toEqual([]);
    await fs.access(store.root);
    await store.saveMeta("older", engineMeta("2026-01-01T00:00:00.000Z"));
    await store.saveMeta("newer", engineMeta("2026-06-01T00:00:00.000Z"));
    await fs.mkdir(path.join(store.root, "empty"));
    await fs.mkdir(path.join(store.root, ".hidden"));
    await fs.writeFile(path.join(store.root, ".hidden", "_meta.json"), JSON.stringify({ projectSlug: ".hidden", ...engineMeta() }));
    expect((await store.listDocs()).map((d) => d.projectSlug)).toEqual(["newer", "older"]);
  });

  it("exports the doc's Markdown and JSON files only", async () => {
    await store.saveChapter(SLUG, { order: 0, title: "Intro", content: "c", abstractionsCovered: [] });
    await store.saveMeta(SLUG, engineMeta());
    await fs.writeFile(path.join(store.root, SLUG, "notes.txt"), "skip");
    const files = await store.exportFiles(SLUG);
    expect(files.map((f) => f.name).sort()).toEqual(["00_intro.md", "_meta.json"]);
    expect(files.find((f) => f.name === "_meta.json")?.content).toContain('"userId": "owner-key-1"');
  });

  it("deletes the whole doc folder and nothing else", async () => {
    await store.saveMeta(SLUG, engineMeta());
    await store.saveMeta("keep-me", engineMeta());
    expect(await store.deleteDoc(SLUG)).toBe(true);
    expect(await store.readMeta(SLUG)).toBeNull();
    expect((await store.listDocs()).map((d) => d.projectSlug)).toEqual(["keep-me"]);
    expect(await store.deleteDoc("never-existed")).toBe(true);
  });
});

describe("FileDocStore path checks (D11s)", () => {
  const BAD_SLUGS = ["..", "../outside", "a/b", "a\\b", "%2e%2e", "a.b", "", " ", "x".repeat(256)];
  const BAD_FILES = ["../_meta.json", "..%2f_meta.md", "a/b.md", "_meta.json", ".hidden.md", "a..md", "chapter.txt", "/etc/passwd.md"];

  beforeEach(async () => {
    // Bait just outside the root: nothing below may reach or remove it.
    await fs.mkdir(outside(), { recursive: true });
    await fs.writeFile(path.join(outside(), "_meta.json"), JSON.stringify({ projectSlug: "outside", ...engineMeta() }));
    await fs.writeFile(path.join(outside(), "secret.md"), "secret");
    await store.saveChapter(SLUG, { order: 0, title: "Intro", content: "c", abstractionsCovered: [] });
    await store.saveMeta(SLUG, engineMeta());
  });

  it.each(BAD_SLUGS)("refuses slug %j everywhere", async (slug) => {
    expect(isSafeDocSlug(slug)).toBe(false);
    expect(() => docDir(slug, store.root)).toThrow("unsafe doc slug");
    expect(await store.readMeta(slug)).toBeNull();
    expect(await store.updateMeta(slug, { linkedProjectId: "p" })).toBeNull();
    expect(await store.readChapter(slug, "secret.md")).toBeNull();
    expect(await store.writeChapter(slug, "secret.md", "pwned")).toBe(false);
    expect(await store.deleteDoc(slug)).toBe(false);
    await expect(store.saveMeta(slug, engineMeta())).rejects.toThrow("unsafe doc slug");
    await expect(store.saveChapter(slug, { order: 0, title: "x", content: "x", abstractionsCovered: [] })).rejects.toThrow("unsafe doc slug");
    await expect(store.exportFiles(slug)).rejects.toThrow("unsafe doc slug");
  });

  it.each(BAD_FILES)("refuses chapter filename %j", async (filename) => {
    expect(isSafeChapterFilename(filename)).toBe(false);
    expect(await store.readChapter(SLUG, filename)).toBeNull();
    expect(await store.writeChapter(SLUG, filename, "pwned")).toBe(false);
  });

  it("left everything outside the root alone", async () => {
    for (const slug of BAD_SLUGS) await store.deleteDoc(slug);
    expect(await fs.readFile(path.join(outside(), "secret.md"), "utf-8")).toBe("secret");
    expect(JSON.parse(await fs.readFile(path.join(outside(), "_meta.json"), "utf-8")).projectSlug).toBe("outside");
    expect(await store.readMeta(SLUG)).not.toBeNull();
  });

  it("returns null for a missing chapter but surfaces other read errors", async () => {
    expect(await store.readChapter(SLUG, "99_missing.md")).toBeNull();
    expect(await store.readChapter("no-such-doc", "00_intro.md")).toBeNull();
    await fs.mkdir(path.join(store.root, SLUG, "01_folder.md"));
    await expect(store.readChapter(SLUG, "01_folder.md")).rejects.toThrow();
  });
});

describe("what loads the disk", () => {
  // docs-output-root is imported widely by the app; it and the engine's
  // interface module must not pull node:fs in. Only file-doc-store may.
  const source = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
  it.each(["src/repoScrapper/store/doc-store.ts", "src/lib/docs-output-root.ts"])("%s imports neither fs nor file-doc-store", (rel) => {
    const imports = [...source(rel).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.filter((s) => /^(node:)?fs(\/|$)|file-doc-store/.test(s))).toEqual([]);
  });
});
