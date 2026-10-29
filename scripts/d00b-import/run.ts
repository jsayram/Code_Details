// D00b orchestrator: the one-time import of P02 capture p02-20261028T173830Z
// into the import backend (P07 §10). Run it through run.sh, which adds the
// loopback-only socket guard. It reads the isolated source container through
// its read-only role, maps rows (mapping.ts), sends them in batches of at most
// 100 to the internal importer functions, uploads the image files, then
// reconciles the target against the source and writes two JSON files into the
// private folder: summary.json (counts, hashes, reasons, pass/fail; safe to
// quote) and detail.json (source IDs, reject lists, diffs; private).
//
// Usage: scripts/d00b-import/run.sh <capture dir> <private dir>
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { FieldReject, Step } from "../../convex/importCore";
import { USERNAME_RESERVATION_MS } from "../../convex/importCore";
import {
  canonicalJson, mapFavorite, mapHistory, mapImage, mapProfile, mapProject, mapProjectTags, mapTag, ms,
  type SrcFavorite, type SrcHistory, type SrcImage, type SrcProfile, type SrcProject, type SrcProjectTag, type SrcTag,
} from "./mapping";

const ROOT = path.resolve(__dirname, "../..");
const SOURCE = "codedetails-d00b-source";
const IMPORT_PORT = "3220";
const BATCH = 100;

const [captureArg, privateArg] = process.argv.slice(2);
if (!captureArg || !privateArg) throw new Error("usage: run.sh <capture dir> <private dir>");
const CAPTURE = path.resolve(captureArg);
const PRIVATE = path.resolve(privateArg);
fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });

const log = (msg: string) => console.log(`[d00b] ${msg}`);
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

// ---------- target: only the import backend ----------
const envText = fs.readFileSync(path.join(ROOT, ".test-runtime/convex-import.env"), "utf8");
const targetUrl = new URL(/CONVEX_SELF_HOSTED_URL=(\S+)/.exec(envText)![1]);
if (targetUrl.hostname !== "127.0.0.1" || targetUrl.port !== IMPORT_PORT) throw new Error("the import target must be 127.0.0.1:3220");
const { adminKey } = JSON.parse(fs.readFileSync(path.join(ROOT, ".test-runtime/convex-import/deployment.json"), "utf8")) as { adminKey: string };
const client = new ConvexHttpClient(targetUrl.origin, { skipConvexDeploymentUrlCheck: true });
(client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(adminKey);
const fn = {
  begin: makeFunctionReference<"mutation", { sourceCapture: string; sourceFingerprint: string }, string>("importer:begin"),
  batch: makeFunctionReference<"mutation", { runId: string; step: string; rows: unknown[] }, { inserted: number; skipped: number; rejected: number }>("importer:batch"),
  lookup: makeFunctionReference<"query", { sourceTable: string; sourceIds: string[] }, Record<string, string>>("importer:lookup"),
  uploadUrl: makeFunctionReference<"mutation", Record<string, never>, string>("importer:uploadUrl"),
  derive: makeFunctionReference<"mutation", { runId: string; table: "projects" | "tags"; cursor: string | null }, { patched: number; cursor: string | null }>("importer:derive"),
  finish: makeFunctionReference<"mutation", { runId: string; status: "complete" | "failed"; counts: Record<string, number> }, null>("importer:finish"),
  dump: makeFunctionReference<"query", Record<string, never>, Record<string, Record<string, unknown>[]>>("importer:dump"),
};

// ---------- source: read-only role in the network-less container ----------
function psql(query: string): string {
  const r = spawnSync("docker", ["exec", "-i", "-u", "postgres", "-e", "PGPASSFILE=/tmp/.pgpass_reader", SOURCE,
    "psql", "-h", "localhost", "-U", "d00b_reader", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"],
  { input: query, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`source query failed: ${r.stderr}`);
  return r.stdout;
}
const rows = <T>(query: string): T[] => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${query}) t;`)) as T[];

/** P02's fingerprint, limited to the schemas the reader can see (public, storage). */
function sourceFingerprint(): string {
  const sqlText = fs.readFileSync(path.join(PRIVATE, "source/fingerprint.sql"), "utf8")
    .replace("and n.nspname not like 'pg_temp%'", "and n.nspname not like 'pg_temp%' and n.nspname in ('public','storage')");
  return psql(sqlText);
}

// ---------- pre-flight (§10 step 1) ----------
function preflight() {
  const sums = fs.readFileSync(path.join(CAPTURE, "SHA256SUMS"), "utf8").trim().split("\n");
  for (const line of sums) {
    const [hash, name] = line.split(/\s+\*?/, 2);
    if (sha256(fs.readFileSync(path.join(CAPTURE, name))) !== hash) throw new Error(`capture checksum mismatch: ${name}`);
  }
  const expected = fs.readFileSync(path.join(CAPTURE, "fingerprint-before.txt"), "utf8").split("\n")
    .filter((l) => l.startsWith("public|") || l.startsWith("storage|")).join("\n");
  const actual = sourceFingerprint().trim();
  if (actual !== expected.trim()) throw new Error("source fingerprint differs from the capture");
  const tz = psql("show timezone;").trim();
  const readOnly = psql("show default_transaction_read_only;").trim();
  if (tz !== "UTC") throw new Error(`source server TimeZone is ${tz}, not UTC`);
  if (readOnly !== "on") throw new Error("source session is not read-only");
  return { checksums: sums.length, fingerprint: sha256(actual), timeZone: tz, readOnly, tables: actual.split("\n").length };
}

// ---------- private key for HMACs (§5.5) ----------
function importKey(): Buffer {
  const file = path.join(PRIVATE, "import-hmac.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

async function inBatches(runId: string, step: Step, list: unknown[], counts: Record<string, number>) {
  for (let i = 0; i < list.length; i += BATCH) {
    const r = await client.mutation(fn.batch, { runId, step, rows: list.slice(i, i + BATCH) });
    for (const [k, n] of Object.entries(r)) counts[`${step}.${k}`] = (counts[`${step}.${k}`] ?? 0) + n;
  }
}

async function deriveAll(runId: string, table: "projects" | "tags", counts: Record<string, number>) {
  let cursor: string | null = null;
  do {
    const r: { patched: number; cursor: string | null } = await client.mutation(fn.derive, { runId, table, cursor });
    counts[`derive.${table}.patched`] = (counts[`derive.${table}.patched`] ?? 0) + r.patched;
    cursor = r.cursor;
  } while (cursor);
}

const tally = (list: { reason: string }[]) => list.reduce<Record<string, number>>((a, r) => ({ ...a, [r.reason]: (a[r.reason] ?? 0) + 1 }), {});

async function main() {
  const startedAt = new Date().toISOString();
  const pre = preflight();
  log(`pre-flight ok: ${pre.checksums} checksums, ${pre.tables} source tables match the capture, TimeZone ${pre.timeZone}, read-only ${pre.readOnly}`);
  const key = importKey();

  // ---------- read the source ----------
  const src = {
    profiles: rows<SrcProfile>("select id, user_id, email_address, username, first_name, last_name, full_name, role, tier, profile_image_url, created_at, updated_at from public.profiles order by id::text"),
    history: rows<SrcHistory>("select old_username, user_id, new_username, changed_at from public.username_history order by old_username"),
    tags: rows<SrcTag>("select id, name::text as name, description, created_at from public.tags order by id::text"),
    projects: rows<SrcProject>("select id, title, slug, description, created_at, updated_at, user_id, deleted_at, category, url_links, category_data, field_order from public.projects order by id::text"),
    projectTags: rows<SrcProjectTag>("select pt.project_id, pt.tag_id, pt.created_at, t.name::text as tag_name from public.project_tags pt join public.tags t on t.id = pt.tag_id order by pt.project_id::text, pt.tag_id::text"),
    favorites: rows<SrcFavorite>("select id, profile_id, project_id, created_at from public.favorites order by id::text"),
    images: rows<SrcImage>(`select i.id, i.project_id, i.storage_path, i.file_name, i.width, i.height, i.image_type, i.display_order, i.alt_text, i.caption,
      i.uploaded_by, i.created_at, i.deleted_at, i.aspect_ratio, o.id as object_id
      from public.project_images i left join storage.objects o on o.bucket_id = 'project-images' and o.name = i.storage_path order by i.id::text`),
    objects: rows<{ id: string; bucket_id: string; name: string; version: string | null; mimetype: string | null; size: string | null }>(
      "select id, bucket_id, name, version, metadata->>'mimetype' as mimetype, metadata->>'size' as size from storage.objects order by id::text"),
  };
  const emails = src.profiles.map((p) => p.email_address.trim().toLowerCase());

  // ---------- map ----------
  const notes: Record<string, number> = {};
  const fieldRejects: Record<string, FieldReject[]> = { users: [], usernameHistory: [], projects: [], images: [] };
  const users = src.profiles.map((p) => mapProfile(key, p));
  for (const u of users) { fieldRejects.users.push(...u.rejects); for (const n of u.notes) notes[n] = (notes[n] ?? 0) + 1; }
  const history = src.history.map((h) => mapHistory(key, h));
  for (const h of history) fieldRejects.usernameHistory.push(...h.rejects);
  const projects = src.projects.map((p) => mapProject(key, p));
  projects.forEach((p, i) => {
    fieldRejects.projects.push(...p.rejects);
    if (p.rowReject) fieldRejects.projects.push({ sourceTable: "projects", sourceId: src.projects[i].id, reason: p.rowReject });
  });
  const images = src.images.map((i) => mapImage(key, i));
  images.forEach((m, i) => { if (m.rowReject) fieldRejects.images.push({ sourceTable: "project_images", sourceId: src.images[i].id, reason: m.rowReject }); });

  // ---------- run (§10 steps 2–8) ----------
  const runId = await client.mutation(fn.begin, { sourceCapture: path.basename(CAPTURE), sourceFingerprint: pre.fingerprint });
  log(`run ${runId} started`);
  const counts: Record<string, number> = {};
  try {
    await inBatches(runId, "tags", src.tags.map((t) => mapTag(key, t).row!), counts);
    await inBatches(runId, "users", users.map((u) => u.row!), counts);
    await inBatches(runId, "fieldRejects", fieldRejects.users, counts);
    await inBatches(runId, "usernameHistory", history.flatMap((h) => (h.row ? [h.row] : [])), counts);
    await inBatches(runId, "fieldRejects", fieldRejects.usernameHistory, counts);
    await inBatches(runId, "projects", projects.flatMap((p) => (p.row ? [p.row] : [])), counts);
    await inBatches(runId, "fieldRejects", fieldRejects.projects, counts);
    await inBatches(runId, "projectTags", mapProjectTags(key, src.projectTags), counts);
    await inBatches(runId, "favorites", src.favorites.map((f) => mapFavorite(key, f)), counts);
    await deriveAll(runId, "projects", counts);
    await deriveAll(runId, "tags", counts);

    // Files (§10 step 7): upload only objects an imported image needs and that aren't mapped yet.
    const imageRows = images.flatMap((m) => (m.row ? [m.row] : []));
    const projectMap = await client.query(fn.lookup, { sourceTable: "projects", sourceIds: [...new Set(imageRows.map((r) => r.projectSourceId))] });
    const needed = [...new Set(imageRows.filter((r) => projectMap[r.projectSourceId]).map((r) => r.objectSourceId))];
    const already = await client.query(fn.lookup, { sourceTable: "storage.objects", sourceIds: needed });
    const manifest = new Map(fs.readFileSync(path.join(CAPTURE, "storage-files.sha256"), "utf8").trim().split("\n").map((l) => {
      const [hash, file] = l.split(/\s+/, 2);
      return [file, hash] as const;
    }));
    const fileRows = [];
    for (const id of needed.filter((n) => !already[n])) {
      const o = src.objects.find((x) => x.id === id)!;
      const tarPath = `./stub/stub/${o.bucket_id}/${o.name}/${o.version}`;
      const expected = manifest.get(tarPath);
      if (!expected) throw new Error(`object ${id} is not in the P02 storage manifest`);
      const r = spawnSync("tar", ["-xOf", path.join(CAPTURE, "storage-mnt.tar"), tarPath], { maxBuffer: 64 << 20 });
      if (r.status !== 0) throw new Error(`could not read object ${id} from the capture`);
      const bytes = r.stdout;
      if (sha256(bytes) !== expected) throw new Error(`object ${id} doesn't match the P02 manifest`);
      const url = await client.mutation(fn.uploadUrl, {});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": o.mimetype ?? "application/octet-stream" }, body: bytes });
      if (!res.ok) throw new Error(`upload of object ${id} failed: ${res.status}`);
      const { storageId } = (await res.json()) as { storageId: string };
      fileRows.push({ sourceId: id, rowHash: sha256(`storage.objects\n${expected}`), storageId, sha256Hex: expected, size: bytes.length });
    }
    counts["files.uploaded"] = fileRows.length;
    counts["files.alreadyMapped"] = Object.keys(already).length;
    await inBatches(runId, "files", fileRows, counts);
    await inBatches(runId, "fieldRejects", fieldRejects.images, counts);
    await inBatches(runId, "images", imageRows, counts);
  } catch (err) {
    await client.mutation(fn.finish, { runId, status: "failed", counts });
    throw err;
  }

  // ---------- reconciliation (§10 step 9) ----------
  const dump = await client.query(fn.dump, {});
  const rec = reconcile(src, dump, runId, key, emails, manifestSizes());
  const after = sourceFingerprint().trim();
  rec.checks.sourceUnchanged = sha256(after) === pre.fingerprint;
  const passed = Object.values(rec.checks).every(Boolean);
  await client.mutation(fn.finish, { runId, status: passed ? "complete" : "failed", counts: { ...counts, reconciliationPassed: passed ? 1 : 0 } });

  const runRejects = (dump.importRejects as { runId: string; sourceTable: string; sourceId: string; reason: string }[]).filter((r) => r.runId === runId);
  const summary = {
    run: runId, startedAt, finishedAt: new Date().toISOString(), capture: path.basename(CAPTURE), preflight: pre,
    batchCounts: counts, notes, rejectsByTableAndReason: tally(runRejects.map((r) => ({ reason: `${r.sourceTable}:${r.reason}` }))),
    rejectsHash: sha256(runRejects.map((r) => `${r.sourceTable}|${r.sourceId}|${r.reason}`).sort().join("\n")),
    sourceCounts: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v.length])),
    targetCounts: rec.targetCounts, expectedCounts: rec.expectedCounts, privacy: rec.privacy, tableHashes: rec.hashes, checks: rec.checks, passed,
  };
  const stamp = startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  fs.writeFileSync(path.join(PRIVATE, `summary-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(PRIVATE, `detail-${stamp}.json`), `${JSON.stringify({ rejects: runRejects, problems: rec.problems }, null, 2)}\n`, { mode: 0o600 });
  log(`counts ${JSON.stringify(counts)}`);
  log(`rejects ${JSON.stringify(summary.rejectsByTableAndReason)}`);
  log(`checks ${JSON.stringify(rec.checks)}`);
  log(`${passed ? "PASSED" : "FAILED"}; summary-${stamp}.json and detail-${stamp}.json in the private folder`);
  if (!passed) process.exitCode = 1;
}

function manifestSizes(): Map<string, number> {
  return new Map(fs.readFileSync(path.join(CAPTURE, "storage-files.sizes"), "utf8").trim().split("\n").map((l) => {
    const [size, file] = l.trim().split(/\s+/, 2);
    return [file, Number(size)] as const;
  }));
}

type D = Record<string, unknown> & { _id: string };

/**
 * Compares the target with what the source says it should hold. Expected
 * values come from the source rows and plain SQL-free arithmetic over them
 * (owners, favorites, tag links), not from reading the target back.
 */
function reconcile(
  src: {
    profiles: SrcProfile[]; history: SrcHistory[]; tags: SrcTag[]; projects: SrcProject[]; projectTags: SrcProjectTag[];
    favorites: SrcFavorite[]; images: SrcImage[]; objects: { id: string; bucket_id: string; name: string; version: string | null }[];
  },
  dump: Record<string, Record<string, unknown>[]>, runId: string, key: Buffer, emails: string[], sizes: Map<string, number>,
) {
  const problems: string[] = [];
  const t = (name: string) => dump[name] as D[];
  const byId = new Map<string, D>();
  for (const [name, list] of Object.entries(dump)) for (const d of list as D[]) byId.set(`${name}:${d._id}`, d);
  // target ID → source ID, per importMap.
  const back = new Map<string, string>();
  for (const m of t("importMap")) if (m.sourceTable !== "profiles.email") back.set(`${m.targetTable}:${m.targetId}`, m.sourceId as string);
  const src2 = (table: string, id: unknown) => back.get(`${table}:${id}`) ?? `unmapped:${id}`;
  const runOf = new Map(t("importMap").map((m) => [`${m.targetTable}:${m.targetId}`, m.runId as string]));
  const runs = new Map(t("importRuns").map((r) => [r._id, r]));

  // Expected relationships, straight from the source.
  const profileBySubject = new Map(src.profiles.map((p) => [p.user_id, p]));
  const importedProjects = src.projects.filter((p) => profileBySubject.has(p.user_id) && mapProject(key, p).row);
  const importedProjectIds = new Set(importedProjects.map((p) => p.id));
  const tagIds = new Set(src.tags.map((x) => x.id));
  const expectedLinks = src.projectTags.filter((pt) => importedProjectIds.has(pt.project_id) && tagIds.has(pt.tag_id));
  const profileIds = new Set(src.profiles.map((p) => p.id));
  const expectedFavs = src.favorites.filter((f) => profileIds.has(f.profile_id) && importedProjectIds.has(f.project_id));
  const expectedImages = src.images.filter((i) => importedProjectIds.has(i.project_id) && profileBySubject.has(i.uploaded_by) && i.object_id);
  const subjectOfProfile = new Map(src.profiles.map((p) => [p.id, p.user_id]));
  const linksByProject = new Map<string, string[]>();
  for (const r of mapProjectTags(key, expectedLinks)) {
    const list = linksByProject.get(r.projectSourceId) ?? [];
    list[r.position] = r.tagSourceId;
    linksByProject.set(r.projectSourceId, list);
  }
  const listedProjects = new Set(importedProjects.filter((p) => !p.deleted_at).map((p) => p.id));

  const lines: Record<string, { expected: string[]; actual: string[] }> = {};
  const add = (table: string, side: "expected" | "actual", value: unknown) => {
    lines[table] ??= { expected: [], actual: [] };
    lines[table][side].push(canonicalJson(value));
  };

  // tags
  for (const s of src.tags) {
    const m = mapTag(key, s).row!;
    const listedCount = expectedLinks.filter((l) => l.tag_id === s.id && listedProjects.has(l.project_id)).length;
    add("tags", "expected", { id: s.id, name: m.name, nameKey: m.nameKey, description: m.description, status: "active", listedProjectCount: listedCount, createdAt: m.createdAt });
  }
  for (const d of t("tags")) add("tags", "actual", { id: src2("tags", d._id), name: d.name, nameKey: d.nameKey, description: d.description, status: d.status, listedProjectCount: d.listedProjectCount, createdAt: d.createdAt });

  // users + authLinks + profiles + current usernames
  for (const p of src.profiles) {
    const m = mapProfile(key, p).row!;
    add("users", "expected", {
      id: p.id, subject: p.user_id, role: "user", tier: m.tier, status: "active", createdAt: m.createdAt, username: m.username, usernameKey: m.usernameKey,
      firstName: m.firstName, lastName: m.lastName, fullName: m.fullName, avatar: m.avatarUrl ? { kind: "external", url: m.avatarUrl } : undefined,
      updatedAt: m.updatedAt, current: [m.usernameKey],
    });
  }
  for (const u of t("users")) {
    const links = t("authLinks").filter((l) => l.userId === u._id);
    const prof = t("profiles").filter((p) => p.userId === u._id);
    const current = t("usernames").filter((n) => n.userId === u._id && n.state === "current");
    if (links.length !== 1 || prof.length !== 1) problems.push(`user ${src2("users", u._id)}: ${links.length} authLinks, ${prof.length} profiles`);
    const p = prof[0] ?? {};
    add("users", "actual", {
      id: src2("users", u._id), subject: links[0]?.subject, role: u.role, tier: u.tier, status: u.status, createdAt: u.createdAt,
      username: p.username, usernameKey: p.usernameKey, firstName: p.firstName, lastName: p.lastName, fullName: p.fullName, avatar: p.avatar,
      updatedAt: p.updatedAt, current: current.map((c) => c.usernameKey),
    });
  }

  // previous usernames
  for (const h of src.history) {
    const m = mapHistory(key, h).row;
    if (!m || !profileBySubject.has(h.user_id)) continue;
    add("usernamesPrevious", "expected", { id: m.sourceId, user: profileBySubject.get(h.user_id)!.id, usernameKey: m.usernameKey, releasedAt: m.releasedAt });
  }
  for (const n of t("usernames").filter((x) => x.state === "previous")) {
    add("usernamesPrevious", "actual", { id: src2("usernames", n._id), user: src2("users", n.userId), usernameKey: n.usernameKey, releasedAt: n.releasedAt });
    const run = runs.get(runOf.get(`usernames:${n._id}`) ?? "");
    if (!run || n.reservedUntil !== (run.startedAt as number) + USERNAME_RESERVATION_MS) problems.push(`previous username ${src2("usernames", n._id)}: reservedUntil is not its run start + 90 days`);
  }

  // projects (+ slugs, derived counters)
  for (const p of importedProjects) {
    const m = mapProject(key, p).row!;
    const favs = expectedFavs.filter((f) => f.project_id === p.id);
    const tagList = linksByProject.get(p.id) ?? [];
    add("projects", "expected", {
      id: p.id, owner: profileBySubject.get(p.user_id)!.id, title: m.title, titleSortKey: m.titleSortKey, slug: m.slug, description: m.description,
      category: m.category, categoryData: m.categoryData, fieldOrder: m.fieldOrder, links: m.links, visibility: "public", status: m.status, deletedAt: m.deletedAt,
      listed: m.status === "active", tags: tagList, tagCount: tagList.length, favoriteCount: favs.length,
      rankingFavoriteCount: favs.filter((f) => subjectOfProfile.get(f.profile_id) !== p.user_id).length, contentVersion: 1, shuffleKey: m.shuffleKey,
      createdAt: m.createdAt, updatedAt: m.updatedAt, slugs: [`current:${m.slug}`],
    });
  }
  for (const d of t("projects")) {
    add("projects", "actual", {
      id: src2("projects", d._id), owner: src2("users", d.ownerId), title: d.title, titleSortKey: d.titleSortKey, slug: d.slug, description: d.description,
      category: d.category, categoryData: d.categoryData, fieldOrder: d.fieldOrder, links: d.links, visibility: d.visibility, status: d.status, deletedAt: d.deletedAt,
      listed: d.listed, tags: (d.tagIds as string[]).map((x) => src2("tags", x)), tagCount: d.tagCount, favoriteCount: d.favoriteCount,
      rankingFavoriteCount: d.rankingFavoriteCount, contentVersion: d.contentVersion, shuffleKey: d.shuffleKey, createdAt: d.createdAt, updatedAt: d.updatedAt,
      slugs: t("projectSlugs").filter((s) => s.projectId === d._id).map((s) => `${s.state}:${s.slug}`),
    });
  }

  // projectTags
  for (const r of mapProjectTags(key, expectedLinks)) add("projectTags", "expected", { project: r.projectSourceId, tag: r.tagSourceId, position: r.position, listed: listedProjects.has(r.projectSourceId) });
  for (const d of t("projectTags")) add("projectTags", "actual", { project: src2("projects", d.projectId), tag: src2("tags", d.tagId), position: d.position, listed: d.listed });

  // favorites
  for (const f of expectedFavs) add("favorites", "expected", { id: f.id, user: f.profile_id, project: f.project_id, createdAt: ms(f.created_at, 0), listed: listedProjects.has(f.project_id) });
  for (const d of t("favorites")) add("favorites", "actual", { id: src2("favorites", d._id), user: src2("users", d.userId), project: src2("projects", d.projectId), createdAt: d.createdAt, listed: d.listed });

  // images and files
  const storage = new Map(t("_storage").map((s) => [s._id, s]));
  let filesChecked = 0;
  for (const i of expectedImages) {
    const m = mapImage(key, i).row!;
    const o = src.objects.find((x) => x.id === i.object_id)!;
    add("projectImages", "expected", {
      id: i.id, project: i.project_id, uploader: profileBySubject.get(i.uploaded_by)!.id, file: o.id, kind: m.kind, displayOrder: m.displayOrder, altText: m.altText,
      caption: m.caption, width: m.width, height: m.height, aspectRatio: m.aspectRatio, fileName: m.fileName, size: sizes.get(`./stub/stub/${o.bucket_id}/${o.name}/${o.version}`),
      status: m.status, deletedAt: m.deletedAt, createdAt: m.createdAt,
    });
  }
  const shaManifest = new Map(fs.readFileSync(path.join(CAPTURE, "storage-files.sha256"), "utf8").trim().split("\n").map((l) => {
    const [hash, file] = l.split(/\s+/, 2);
    return [file, hash] as const;
  }));
  for (const d of t("projectImages")) {
    const file = src2("_storage", d.storageId);
    add("projectImages", "actual", {
      id: src2("projectImages", d._id), project: src2("projects", d.projectId), uploader: src2("users", d.uploadedBy), file, kind: d.kind, displayOrder: d.displayOrder,
      altText: d.altText, caption: d.caption, width: d.width, height: d.height, aspectRatio: d.aspectRatio, fileName: d.fileName, size: d.size,
      status: d.status, deletedAt: d.deletedAt, createdAt: d.createdAt,
    });
    const s = storage.get(d.storageId as string);
    const o = src.objects.find((x) => x.id === file);
    const tarPath = o && `./stub/stub/${o.bucket_id}/${o.name}/${o.version}`;
    const hex = s ? Buffer.from(s.sha256 as string, "base64").toString("hex") : "";
    if (!s || !tarPath || hex !== shaManifest.get(tarPath) || s.size !== sizes.get(tarPath)) problems.push(`image ${src2("projectImages", d._id)}: file SHA-256 or size differs from the P02 manifest`);
    else filesChecked++;
  }

  const hashes: Record<string, { expected: string; actual: string; rows: number; match: boolean }> = {};
  for (const [table, { expected, actual }] of Object.entries(lines)) {
    const e = sha256(expected.sort().join("\n"));
    const a = sha256(actual.sort().join("\n"));
    hashes[table] = { expected: e, actual: a, rows: actual.length, match: e === a && expected.length === actual.length };
    if (e !== a) {
      const es = new Set(expected);
      const as = new Set(actual);
      problems.push(`${table}: ${actual.filter((x) => !es.has(x)).length} unexpected and ${expected.filter((x) => !as.has(x)).length} missing rows`, ...actual.filter((x) => !es.has(x)).map((x) => `${table} unexpected ${x}`), ...expected.filter((x) => !as.has(x)).map((x) => `${table} missing ${x}`));
    }
  }

  // Relationships: every reference points at an existing document.
  let danglingRefs = 0;
  const ref = (table: string, id: unknown, what: string) => { if (!byId.has(`${table}:${id}`)) { danglingRefs++; problems.push(`dangling ${what}`); } };
  for (const d of t("authLinks")) ref("users", d.userId, "authLinks.userId");
  for (const d of t("profiles")) ref("users", d.userId, "profiles.userId");
  for (const d of t("usernames")) ref("users", d.userId, "usernames.userId");
  for (const d of t("projects")) { ref("users", d.ownerId, "projects.ownerId"); for (const x of d.tagIds as string[]) ref("tags", x, "projects.tagIds"); }
  for (const d of t("projectSlugs")) ref("projects", d.projectId, "projectSlugs.projectId");
  for (const d of t("projectTags")) { ref("projects", d.projectId, "projectTags.projectId"); ref("tags", d.tagId, "projectTags.tagId"); }
  for (const d of t("favorites")) { ref("users", d.userId, "favorites.userId"); ref("projects", d.projectId, "favorites.projectId"); }
  for (const d of t("projectImages")) { ref("projects", d.projectId, "projectImages.projectId"); ref("users", d.uploadedBy, "projectImages.uploadedBy"); ref("_storage", d.storageId, "projectImages.storageId"); }

  // Derived values, recomputed from target rows alone.
  let derivedMismatches = 0;
  for (const p of t("projects")) {
    const links = t("projectTags").filter((l) => l.projectId === p._id).sort((a, b) => (a.position as number) - (b.position as number));
    const favs = t("favorites").filter((f) => f.projectId === p._id);
    const ok = (p.tagIds as string[]).join() === links.map((l) => l.tagId).join() && p.tagCount === links.length
      && p.favoriteCount === favs.length && p.rankingFavoriteCount === favs.filter((f) => f.userId !== p.ownerId).length
      && p.listed === (p.status === "active" && p.visibility === "public")
      && links.every((l) => l.listed === p.listed) && favs.every((f) => f.listed === p.listed);
    if (!ok) { derivedMismatches++; problems.push(`derived values wrong on project ${src2("projects", p._id)}`); }
  }
  for (const tag of t("tags")) {
    const n = t("projectTags").filter((l) => l.tagId === tag._id && l.listed === true).length;
    if (tag.listedProjectCount !== n) { derivedMismatches++; problems.push(`listedProjectCount wrong on tag ${src2("tags", tag._id)}`); }
  }

  // Privacy (§10): no imported email anywhere in the target, no `@` in public
  // tables, no Clerk subject outside authLinks, no localhost URL.
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
    return out;
  };
  const PUBLIC = ["profiles", "projects", "projectSlugs", "tags", "tagAliases", "projectTags", "projectImages", "usernames"];
  const privacy = { emailAnywhere: 0, atInPublicTables: 0, subjectOutsideAuthLinks: 0, localhostUrls: 0 };
  for (const [table, list] of Object.entries(dump)) {
    for (const d of list as D[]) {
      for (const s of strings(d)) {
        const lower = s.toLowerCase();
        if (emails.some((e) => lower.includes(e))) { privacy.emailAnywhere++; problems.push(`email found in ${table}`); }
        if (PUBLIC.includes(table) && s.includes("@")) { privacy.atInPublicTables++; problems.push(`'@' in ${table}`); }
        if (table !== "authLinks" && /\buser_[A-Za-z0-9]{6,}/.test(s)) { privacy.subjectOutsideAuthLinks++; problems.push(`provider subject in ${table}`); }
        if (/\b(localhost|127\.0\.0\.1)\b/.test(lower)) { privacy.localhostUrls++; problems.push(`localhost value in ${table}`); }
      }
    }
  }

  const targetCounts = Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
  const expectedCounts = {
    tags: src.tags.length, users: src.profiles.length, projects: importedProjects.length, projectTags: expectedLinks.length,
    favorites: expectedFavs.length, projectImages: expectedImages.length,
  };
  const checks: Record<string, boolean> = {
    countsMatch: Object.entries(expectedCounts).every(([k, n]) => targetCounts[k] === n),
    hashesMatch: Object.values(hashes).every((h) => h.match),
    relationships: danglingRefs === 0,
    derivedValues: derivedMismatches === 0,
    files: filesChecked === expectedImages.length && t("_storage").length === new Set(expectedImages.map((i) => i.object_id)).size,
    privacy: Object.values(privacy).every((n) => n === 0),
    ownerMissingAsExpected: (() => {
      const expectedOwnerless = new Set(src.projects.filter((p) => !profileBySubject.has(p.user_id)).map((p) => p.id));
      const got = new Set(t("importRejects").filter((r) => r.runId === runId && r.sourceTable === "projects" && r.reason === "owner_missing").map((r) => r.sourceId as string));
      return got.size === expectedOwnerless.size && [...got].every((x) => expectedOwnerless.has(x));
    })(),
    noOtherProblems: problems.length === 0,
  };
  return { checks, hashes, problems, targetCounts, expectedCounts, privacy };
}

main().catch((err) => {
  console.error(`[d00b] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
