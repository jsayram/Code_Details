// Generator re-key, slice 3: scripts/docs-rekey.mjs. Runs the real script on a
// synthetic doc set in its own folder under the isolated output root
// (.test-runtime/docs-output), never on src/app/output. Dry run writes
// nothing and prints no personal data; apply backs up first, rewrites
// atomically and is idempotent; restore puts the bytes back; the guards refuse
// what they should. After a re-key the app still finds the owner both ways.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock calls below are hoisted above these imports by Vitest.
import { isDocOwner } from "@/lib/docs-access";
import { docsOutputRoot } from "@/lib/docs-output-root";
import type { DocOwner } from "@/lib/auth-server";

vi.mock("@/lib/auth-server", () => ({}));
vi.mock("@/backend/projects/personal", () => ({ personalReadsFromConvex: () => false }));
vi.mock("@/backend/projects", () => ({ getProjectReadBackend: () => ({}) }));
vi.mock("@/db/project-read", () => ({ readProjectBySlug: async () => null }));

const ROOT_DIR = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT_DIR, "scripts", "docs-rekey.mjs");
const OUTPUT = docsOutputRoot();
const ROOT = path.join(OUTPUT, `rekey-tool-${process.pid}`);
const WORK = path.join(ROOT_DIR, ".test-runtime", `rekey-tool-work-${process.pid}`);
const MAP_FILE = path.join(WORK, "map.json");
const backupDir = (n: string) => path.join(WORK, `backup-${n}`);

const CLERK_A = "user_fixture_rekeytool_a";
const CLERK_B = "user_fixture_rekeytool_b";
const CLERK_GONE = "user_fixture_rekeytool_unmapped";
const ACC_A = "k17rekeytoolaccountaaaaaaaaaaaaa";
const ACC_B = "k17rekeytoolaccountbbbbbbbbbbbbb";
const MAP = { [CLERK_A]: ACC_A, [CLERK_B]: ACC_B };
const SLUGS = { a1: "rekeytool-a-one", a2: "rekeytool-a-two", b: "rekeytool-b", gone: "rekeytool-unmapped", done: "rekeytool-already", fresh: "rekeytool-fresh", broken: "rekeytool-broken" };
const SECRET_WORDS = [CLERK_A, CLERK_B, CLERK_GONE, ACC_A, ACC_B, ...Object.values(SLUGS), "synthetic-repo"];

const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const metaFile = (slug: string, root = ROOT) => path.join(root, slug, "_meta.json");
const readMeta = (slug: string) => JSON.parse(fs.readFileSync(metaFile(slug), "utf8"));

function writeDoc(slug: string, meta: object | string, root = ROOT) {
  fs.mkdirSync(path.join(root, slug), { recursive: true });
  fs.writeFileSync(metaFile(slug, root), typeof meta === "string" ? meta : JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(root, slug, "01_intro.md"), "Synthetic chapter.\n");
}
const meta = (slug: string, userId: string, extra: object = {}) => ({
  projectSlug: slug,
  userId,
  repoUrl: "https://github.com/synthetic/synthetic-repo",
  repoOwner: "synthetic",
  repoName: "synthetic-repo",
  createdAt: "2026-10-30T00:00:00.000Z",
  chapters: [{ order: 1, title: "Intro", filename: "01_intro.md" }],
  llmProvider: "synthetic",
  llmModel: "synthetic",
  ...extra,
});

function run(...args: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}
const allHashes = () =>
  Object.fromEntries(
    (fs.readdirSync(ROOT, { recursive: true }) as string[]).sort().filter((f) => fs.statSync(path.join(ROOT, f)).isFile()).map((f) => [f, sha(path.join(ROOT, f))]),
  );

function reset() {
  for (const d of [ROOT, WORK]) fs.rmSync(d, { recursive: true, force: true });
  // Never anywhere but the isolated test areas
  expect(ROOT.split(path.sep)).toContain(".test-runtime");
  expect(ROOT).not.toContain(path.join("src", "app", "output"));
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(MAP));
  writeDoc(SLUGS.a1, meta(SLUGS.a1, CLERK_A, { linkedProjectId: "00000000-0000-4000-8000-0000000000a1", linkedProjectSlug: "p", linkedProjectTitle: "P" }));
  writeDoc(SLUGS.a2, meta(SLUGS.a2, CLERK_A));
  writeDoc(SLUGS.b, meta(SLUGS.b, CLERK_B));
  writeDoc(SLUGS.gone, meta(SLUGS.gone, CLERK_GONE));
  writeDoc(SLUGS.done, meta(SLUGS.done, ACC_A, { legacyUserId: CLERK_A }));
  writeDoc(SLUGS.fresh, meta(SLUGS.fresh, "k17rekeytoolaccountfreshfreshfre"));
  writeDoc(SLUGS.broken, "{ not json");
  // A symlinked doc folder pointing outside the root: never followed
  const outside = path.join(WORK, "outside");
  writeDoc("target", meta("target", CLERK_A), outside);
  fs.symlinkSync(path.join(outside, "target"), path.join(ROOT, "rekeytool-symlinked"));
  fs.mkdirSync(path.join(ROOT, "not a slug"));
}

beforeEach(reset);
afterAll(() => {
  for (const d of [ROOT, WORK]) fs.rmSync(d, { recursive: true, force: true });
});

describe("docs-rekey dry run", () => {
  it("counts without writing anything and prints no subject, ID, slug or repo", () => {
    const before = allHashes();
    const { code, out } = run("--root", ROOT, "--map", MAP_FILE);
    expect(code).toBe(0);
    expect(out).toContain("dry run (nothing written)");
    expect(out).toContain("docs scanned: 6");
    expect(out).toContain("already re-keyed: 2");
    expect(out).toContain("to re-key: 3");
    expect(out).toContain("no mapping (left as is): 1");
    expect(out).toContain("skipped: 0 without metadata, 1 unreadable, 1 unsafe names, 1 symlinks");
    expect(out).toMatch(/owner#1: 2 to re-key, 1 already, 0 unmapped/);
    for (const word of [...SECRET_WORDS, ROOT, ROOT_DIR]) expect(out).not.toContain(word);
    expect(allHashes()).toEqual(before);
    expect(fs.readdirSync(WORK).sort()).toEqual(["map.json", "outside"]);
  });
});

describe("docs-rekey apply and restore", () => {
  it("backs up first, rewrites only mapped Clerk-keyed docs, keeps every other field and the key order", () => {
    const before = allHashes();
    const outsideBefore = sha(path.join(WORK, "outside", "target", "_meta.json"));
    const original = readMeta(SLUGS.a1);
    const { code, out } = run("--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("1"));
    expect(code, out).toBe(0);
    expect(out).toContain("rewritten: 3");
    for (const word of SECRET_WORDS) expect(out).not.toContain(word);

    expect(readMeta(SLUGS.a1)).toEqual({ ...original, userId: ACC_A, legacyUserId: CLERK_A });
    expect(Object.keys(readMeta(SLUGS.a1))).toEqual(["projectSlug", "userId", "legacyUserId", ...Object.keys(original).slice(2)]);
    expect(readMeta(SLUGS.a2)).toMatchObject({ userId: ACC_A, legacyUserId: CLERK_A });
    expect(readMeta(SLUGS.b)).toMatchObject({ userId: ACC_B, legacyUserId: CLERK_B });
    // Untouched: unmapped, already re-keyed, account-keyed, unreadable, chapters, the symlink target
    for (const f of [SLUGS.gone, SLUGS.done, SLUGS.fresh, SLUGS.broken].map((s) => `${s}/_meta.json`)) expect(sha(path.join(ROOT, f)), f).toBe(before[f]);
    for (const f of Object.keys(before).filter((f) => f.endsWith(".md"))) expect(sha(path.join(ROOT, f))).toBe(before[f]);
    expect(sha(path.join(WORK, "outside", "target", "_meta.json"))).toBe(outsideBefore);
    expect(fs.readdirSync(path.join(ROOT, SLUGS.a1)).sort()).toEqual(["01_intro.md", "_meta.json"]);

    // The backup holds the original bytes and a manifest with their hashes
    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir("1"), "manifest.json"), "utf8"));
    expect(manifest.entries.map((e: { slug: string }) => e.slug).sort()).toEqual([SLUGS.a1, SLUGS.a2, SLUGS.b].sort());
    for (const e of manifest.entries) {
      expect(sha(path.join(backupDir("1"), e.slug, "_meta.json"))).toBe(e.before);
      expect(e.before).toBe(before[`${e.slug}/_meta.json`]);
      expect(sha(metaFile(e.slug))).toBe(e.after);
    }
  });

  it("a second run changes nothing", () => {
    expect(run("--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("1")).code).toBe(0);
    const after = allHashes();
    const { code, out } = run("--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("2"));
    expect(code).toBe(0);
    expect(out).toContain("to re-key: 0");
    expect(out).toContain("rewritten: 0");
    expect(allHashes()).toEqual(after);
  });

  it("the app finds the owner of a re-keyed doc in Clerk mode and under the switch, and nobody else", () => {
    expect(run("--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("1")).code).toBe(0);
    const doc = readMeta(SLUGS.a1);
    const owner = (keys: string[]): DocOwner => ({ writeKey: keys[0], keys, legacyUserId: null, projectViewer: null });
    expect(isDocOwner(doc, owner([CLERK_A]))).toBe(true); // Clerk mode
    expect(isDocOwner(doc, owner([ACC_A]))).toBe(true); // Better Auth, no Clerk link
    expect(isDocOwner(doc, owner([ACC_A, CLERK_A]))).toBe(true);
    expect(isDocOwner(doc, owner([CLERK_B]))).toBe(false);
    expect(isDocOwner(doc, owner([ACC_B, CLERK_B]))).toBe(false);
  });

  it("restore puts the original bytes back, leaves a file edited since the re-key alone, and can run twice", () => {
    const before = allHashes();
    expect(run("--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("1")).code).toBe(0);
    // Someone edits one doc after the re-key
    const edited = { ...readMeta(SLUGS.b), linkedProjectTitle: "Edited later" };
    fs.writeFileSync(metaFile(SLUGS.b), JSON.stringify(edited, null, 2));
    const editedHash = sha(metaFile(SLUGS.b));

    const first = run("--root", ROOT, "--restore", backupDir("1"));
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain("restored: 2");
    expect(first.out).toContain("changed since the re-key (left as is): 1");
    expect(sha(metaFile(SLUGS.a1))).toBe(before[`${SLUGS.a1}/_meta.json`]);
    expect(sha(metaFile(SLUGS.a2))).toBe(before[`${SLUGS.a2}/_meta.json`]);
    expect(sha(metaFile(SLUGS.b))).toBe(editedHash);

    const second = run("--root", ROOT, "--restore", backupDir("1"));
    expect(second.code).toBe(0);
    expect(second.out).toContain("restored: 0");
    expect(sha(metaFile(SLUGS.a1))).toBe(before[`${SLUGS.a1}/_meta.json`]);
  });

  it("restore refuses a backup made for another root or a tampered backup file", () => {
    expect(run("--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("1")).code).toBe(0);
    const other = path.join(WORK, "other-root");
    fs.mkdirSync(other);
    expect(run("--root", other, "--restore", backupDir("1")).code).toBe(2);
    const after = sha(metaFile(SLUGS.a1));
    fs.appendFileSync(path.join(backupDir("1"), SLUGS.a1, "_meta.json"), " ");
    const res = run("--root", ROOT, "--restore", backupDir("1"));
    expect(res.code).not.toBe(0);
    expect(sha(metaFile(SLUGS.a1))).toBe(after);
  });
});

describe("docs-rekey guards", () => {
  it("refuses bad arguments and writes nothing", () => {
    const before = allHashes();
    fs.mkdirSync(backupDir("full"));
    fs.writeFileSync(path.join(backupDir("full"), "x"), "x");
    const bad = path.join(WORK, "bad-map.json");
    fs.writeFileSync(bad, JSON.stringify({ [CLERK_A]: "not an account id" }));
    const cases: string[][] = [
      [],
      ["--root", ROOT],
      ["--root", ROOT, "--map", MAP_FILE, "--apply"],
      ["--root", ROOT, "--map", MAP_FILE, "--backup", backupDir("x")],
      ["--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", backupDir("full")],
      ["--root", ROOT, "--map", MAP_FILE, "--apply", "--backup", path.join(ROOT, "inside-backup")],
      ["--root", ROOT, "--map", bad],
      ["--root", ROOT, "--map", path.join(WORK, "missing.json")],
      ["--root", path.join(WORK, "missing-root"), "--map", MAP_FILE],
      ["--root", ROOT, "--map", MAP_FILE, "--surprise"],
    ];
    for (const args of cases) expect(run(...args).code, args.join(" ")).toBe(2);
    expect(allHashes()).toEqual(before);
    expect(fs.existsSync(path.join(ROOT, "inside-backup"))).toBe(false);
  });

  it("refuses any root that is a src/app/output unless told it means the real output", () => {
    // A synthetic stand-in with the same path ending, inside the test area
    const fake = path.join(WORK, "checkout", "src", "app", "output");
    writeDoc("fake-doc", meta("fake-doc", CLERK_A), fake);
    const before = sha(metaFile("fake-doc", fake));
    const refused = run("--root", fake, "--map", MAP_FILE, "--apply", "--backup", backupDir("fake"));
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("--i-mean-real-output");
    expect(fs.existsSync(backupDir("fake"))).toBe(false);
    expect(sha(metaFile("fake-doc", fake))).toBe(before);
    // Through a symlink too
    const link = path.join(WORK, "innocent-name");
    fs.symlinkSync(fake, link);
    expect(run("--root", link, "--map", MAP_FILE).code).toBe(2);
    // The flag only lifts this one guard
    const dry = run("--root", fake, "--map", MAP_FILE, "--i-mean-real-output");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("to re-key: 1");
    expect(sha(metaFile("fake-doc", fake))).toBe(before);
  });
});
