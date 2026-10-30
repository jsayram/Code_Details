#!/usr/bin/env node
// Generator re-key: rewrite generated docs' owner from the Clerk-era subject
// to the account's Convex users ID. Each doc's _meta.json gets
// `userId = <account ID>` and keeps the old subject as `legacyUserId`, which
// the app still accepts (src/lib/docs-access.ts isDocOwner), so nothing loses
// its owner in either auth mode.
//
//   node scripts/docs-rekey.mjs --root <output root> --map <mapping.json>
//       Dry run (the default): counts only, nothing written.
//   node scripts/docs-rekey.mjs --root <root> --map <map> --apply --backup <new dir>
//       Copies every _meta.json it will change into <dir>, with a manifest of
//       SHA-256 hashes, then rewrites each one atomically and checks it.
//   node scripts/docs-rekey.mjs --root <root> --restore <backup dir>
//       Puts the backed-up files back, only where the file is still exactly
//       what the re-key wrote.
//
// <mapping.json> is { "<clerk subject>": "<convex users id>" } (from
// identity:clerkSubjectMap). Output never shows a subject, ID, slug, repo or
// path: owners appear as owner#1..n. A root that is a src/app/output (the real
// generated docs) is refused unless --i-mean-real-output is given.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DOC_SLUG = /^[a-z0-9_-]{1,255}$/i; // as src/lib/docs-output-root.ts
const ACCOUNT_ID = /^[0-9a-z]{25,40}$/;
const META = "_meta.json";

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { apply: false, real: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--root") opts.root = value();
    else if (a === "--map") opts.map = value();
    else if (a === "--backup") opts.backup = value();
    else if (a === "--restore") opts.restore = value();
    else if (a === "--apply") opts.apply = true;
    else if (a === "--i-mean-real-output") opts.real = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  if (!opts.root) throw new UsageError("--root is required");
  if (opts.restore && (opts.apply || opts.map || opts.backup)) throw new UsageError("--restore takes only --root");
  if (!opts.restore && !opts.map) throw new UsageError("--map is required");
  if (opts.apply && !opts.backup) throw new UsageError("--apply needs --backup <new directory>");
  if (!opts.apply && opts.backup) throw new UsageError("--backup is only used with --apply");
  return opts;
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function isRealOutput(root) {
  const parts = root.split(path.sep);
  const n = parts.length;
  return n >= 3 && parts[n - 3] === "src" && parts[n - 2] === "app" && parts[n - 1] === "output";
}

function resolveRoot(opts) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(opts.root));
  } catch {
    throw new UsageError("--root does not exist");
  }
  if (!fs.statSync(root).isDirectory()) throw new UsageError("--root is not a directory");
  if (isRealOutput(root) && !opts.real) {
    throw new UsageError("refusing a src/app/output root (the real generated docs) without --i-mean-real-output");
  }
  return root;
}

function readMap(file) {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new UsageError("--map is not readable JSON");
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new UsageError("--map must be a JSON object");
  for (const [subject, id] of Object.entries(map)) {
    if (!subject || typeof id !== "string" || !ACCOUNT_ID.test(id)) throw new UsageError("--map has an entry that isn't subject -> account ID");
  }
  return map;
}

/** Every doc directory's metadata, without following symlinks. */
function scan(root) {
  const docs = [];
  const skipped = { names: 0, links: 0, noMeta: 0, unreadable: 0 };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      skipped.links++;
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!DOC_SLUG.test(entry.name)) {
      skipped.names++;
      continue;
    }
    const file = path.join(root, entry.name, META);
    let st;
    try {
      st = fs.lstatSync(file);
    } catch {
      skipped.noMeta++;
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      skipped.links++;
      continue;
    }
    const raw = fs.readFileSync(file);
    let meta;
    try {
      meta = JSON.parse(raw.toString("utf8"));
    } catch {
      skipped.unreadable++;
      continue;
    }
    if (!meta || typeof meta !== "object" || typeof meta.userId !== "string" || !meta.userId) {
      skipped.unreadable++;
      continue;
    }
    docs.push({ slug: entry.name, file, raw, meta });
  }
  docs.sort((a, b) => a.slug.localeCompare(b.slug));
  return { docs, skipped };
}

/** The new metadata: the same keys in the same order, legacyUserId right after userId. */
function rekeyed(meta, accountId) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "legacyUserId") continue;
    out[k] = k === "userId" ? accountId : v;
    if (k === "userId") out.legacyUserId = meta.userId;
  }
  return out;
}

function plan(docs, map) {
  const ids = new Set(Object.values(map));
  const owners = new Map(); // old key -> { label, toRekey, unmapped, already }
  const label = (key) => {
    if (!owners.has(key)) owners.set(key, { label: `owner#${owners.size + 1}`, toRekey: 0, unmapped: 0, already: 0 });
    return owners.get(key);
  };
  const changes = [];
  let already = 0;
  let unmapped = 0;
  for (const doc of docs) {
    const { userId, legacyUserId } = doc.meta;
    // Already an account ID (re-keyed, or written after the re-key): leave it.
    if (ACCOUNT_ID.test(userId) || ids.has(userId)) {
      already++;
      label(typeof legacyUserId === "string" && legacyUserId ? legacyUserId : userId).already++;
    } else if (Object.hasOwn(map, userId)) {
      label(userId).toRekey++;
      const text = JSON.stringify(rekeyed(doc.meta, map[userId]), null, 2);
      changes.push({ ...doc, next: Buffer.from(text, "utf8") });
    } else {
      unmapped++;
      label(userId).unmapped++;
    }
  }
  return { changes, already, unmapped, owners: [...owners.values()] };
}

function summary(title, scanned, p, skipped, extra = []) {
  const lines = [
    `docs-rekey: ${title}`,
    `docs scanned: ${scanned}`,
    `already re-keyed: ${p.already}`,
    `to re-key: ${p.changes.length}`,
    `no mapping (left as is): ${p.unmapped}`,
    `skipped: ${skipped.noMeta} without metadata, ${skipped.unreadable} unreadable, ${skipped.names} unsafe names, ${skipped.links} symlinks`,
    "owners:",
    ...p.owners.map((o) => `  ${o.label}: ${o.toRekey} to re-key, ${o.already} already, ${o.unmapped} unmapped`),
    ...extra,
  ];
  return lines.join("\n");
}

function writeAtomic(file, buf) {
  const tmp = `${file}.rekey-tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf, { flag: "wx" });
  fs.renameSync(tmp, file);
}

function emptyNewDir(dir) {
  const abs = path.resolve(dir);
  if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isDirectory() || fs.readdirSync(abs).length > 0) throw new UsageError("--backup must be a new or empty directory");
  }
  fs.mkdirSync(abs, { recursive: true });
  return fs.realpathSync(abs);
}

function apply(root, opts, p) {
  const inside = (dir) => dir === root || dir.startsWith(root + path.sep);
  // Checked before anything is created, and again on the real path.
  if (inside(path.resolve(opts.backup))) throw new UsageError("--backup must be outside --root");
  const backup = emptyNewDir(opts.backup);
  if (inside(backup)) throw new UsageError("--backup must be outside --root");
  const entries = [];
  for (const c of p.changes) {
    fs.mkdirSync(path.join(backup, c.slug));
    fs.writeFileSync(path.join(backup, c.slug, META), c.raw, { flag: "wx" });
    entries.push({ slug: c.slug, before: sha256(c.raw), after: sha256(c.next) });
  }
  const manifest = { tool: "docs-rekey", version: 1, createdAt: new Date().toISOString(), root, entries };
  fs.writeFileSync(path.join(backup, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  // Every backup is on disk and verified before the first rewrite.
  for (const e of entries) {
    if (sha256(fs.readFileSync(path.join(backup, e.slug, META))) !== e.before) throw new Error("backup check failed; nothing was rewritten");
  }
  let written = 0;
  for (const c of p.changes) {
    // Refuse a file that changed since the scan.
    if (sha256(fs.readFileSync(c.file)) !== sha256(c.raw)) throw new Error(`a doc changed during the run; ${written} rewritten, restore from the backup`);
    writeAtomic(c.file, c.next);
    if (sha256(fs.readFileSync(c.file)) !== sha256(c.next)) throw new Error(`write check failed after ${written}; restore from the backup`);
    written++;
  }
  return written;
}

function restore(root, dir) {
  const backup = fs.realpathSync(path.resolve(dir));
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "manifest.json"), "utf8"));
  if (manifest.tool !== "docs-rekey" || !Array.isArray(manifest.entries)) throw new UsageError("not a docs-rekey backup");
  if (manifest.root !== root) throw new UsageError("this backup was made for a different --root");
  let restored = 0;
  let changedSince = 0;
  let missing = 0;
  for (const e of manifest.entries) {
    if (!DOC_SLUG.test(e.slug)) throw new UsageError("backup manifest has an unsafe name");
    const saved = fs.readFileSync(path.join(backup, e.slug, META));
    if (sha256(saved) !== e.before) throw new Error("a backup file doesn't match its manifest; nothing more restored");
    const file = path.join(root, e.slug, META);
    let current;
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error("symlink");
      current = fs.readFileSync(file);
    } catch {
      missing++;
      continue;
    }
    if (sha256(current) === e.before) continue; // already restored
    if (sha256(current) !== e.after) {
      changedSince++;
      continue;
    }
    writeAtomic(file, saved);
    restored++;
  }
  return [
    "docs-rekey: restore",
    `in backup: ${manifest.entries.length}`,
    `restored: ${restored}`,
    `changed since the re-key (left as is): ${changedSince}`,
    `missing (left as is): ${missing}`,
  ].join("\n");
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = resolveRoot(opts);
  if (opts.restore) return restore(root, opts.restore);
  const map = readMap(opts.map);
  const { docs, skipped } = scan(root);
  const p = plan(docs, map);
  if (!opts.apply) return summary("dry run (nothing written)", docs.length, p, skipped);
  const written = apply(root, opts, p);
  return summary("applied", docs.length, p, skipped, [`rewritten: ${written}`, "backup: written with manifest.json"]);
}

try {
  console.log(main(process.argv.slice(2)));
} catch (err) {
  console.error(`docs-rekey: ${err instanceof UsageError ? "refused: " : "failed: "}${err.message}`);
  process.exit(err instanceof UsageError ? 2 : 1);
}
