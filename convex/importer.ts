// D00b one-time importer (P07 §10). Internal functions only: callable with the
// admin key, never by a client. Each refuses to run unless the deployment has
// CODEDETAILS_IMPORT_ALLOWED=1, which only `tests/convex/push.mjs --target
// import` sets, on the import backend (127.0.0.1:3220). The decisions live in
// importCore.ts; this file backs them with ctx.db. The orchestrator is
// scripts/d00b-import/run.ts.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";
import { deriveProject, runBatch, type ImportStore, type Step } from "./importCore";

function assertImportAllowed() {
  if (process.env.CODEDETAILS_IMPORT_ALLOWED !== "1") throw new Error("the importer is disabled on this deployment");
}

const APP_TABLES = [
  "users", "authLinks", "profiles", "usernames", "projects", "projectSlugs", "tags", "tagAliases", "projectTags",
  "favorites", "projectImages", "tagSuggestions", "auditEvents", "contentChanges",
] as const;
const IMPORT_TABLES = ["importRuns", "importMap", "importRejects"] as const;

/** base64 (what _storage records) to lowercase hex (what the P02 manifest records). */
function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let out = "";
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

function storeFor(ctx: MutationCtx, runId: Id<"importRuns">): ImportStore {
  const db = ctx.db;
  return {
    async mapped(sourceTable, sourceId) {
      const hit = await db.query("importMap").withIndex("by_source", (q) => q.eq("sourceTable", sourceTable).eq("sourceId", sourceId)).unique();
      return hit ? { targetId: hit.targetId, rowHash: hit.rowHash } : null;
    },
    async map(sourceTable, sourceId, targetTable, targetId, rowHash) {
      await db.insert("importMap", { runId, sourceTable, sourceId, targetTable, targetId, rowHash });
    },
    async rejectedReason(sourceTable, sourceId) {
      const rows = await db.query("importRejects").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
      return rows.find((r) => r.sourceTable === sourceTable && r.sourceId === sourceId)?.reason ?? null;
    },
    async reject(sourceTable, sourceId, reason) {
      await db.insert("importRejects", { runId, sourceTable, sourceId, reason });
    },
    async insert(table, doc) {
      return await db.insert(table as TableNames, doc as never);
    },
    async get(table, id) {
      const docId = db.normalizeId(table as TableNames, id);
      return docId ? ((await db.get(docId)) as Record<string, unknown> | null) : null;
    },
    async userBySubject(subject) {
      const link = await db.query("authLinks").withIndex("by_provider_subject", (q) => q.eq("provider", "clerk").eq("subject", subject)).unique();
      return link?.userId ?? null;
    },
    async tagByNameKey(nameKey) {
      return (await db.query("tags").withIndex("by_nameKey", (q) => q.eq("nameKey", nameKey)).first())?._id ?? null;
    },
    async usernameHolder(usernameKey) {
      const profile = await db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey)).first();
      if (profile) return profile.userId;
      const claim = await db.query("usernames").withIndex("by_usernameKey_state", (q) => q.eq("usernameKey", usernameKey)).first();
      return claim?.userId ?? null;
    },
    async slugHolder(slug) {
      return (await db.query("projectSlugs").withIndex("by_slug", (q) => q.eq("slug", slug)).first())?.projectId ?? null;
    },
    async favoriteExists(userId, projectId) {
      const u = userId as Id<"users">;
      const p = projectId as Id<"projects">;
      return !!(await db.query("favorites").withIndex("by_user_project", (q) => q.eq("userId", u).eq("projectId", p)).first());
    },
    async projectTagCount(projectId) {
      return (await db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", projectId as Id<"projects">)).collect()).length;
    },
    async projectTagExists(projectId, tagId) {
      const p = projectId as Id<"projects">;
      const t = tagId as Id<"tags">;
      return !!(await db.query("projectTags").withIndex("by_project_tag", (q) => q.eq("projectId", p).eq("tagId", t)).first());
    },
    async storageMeta(storageId) {
      const id = db.system.normalizeId("_storage", storageId);
      const meta = id ? await db.system.get(id) : null;
      return meta ? { sha256Hex: base64ToHex(meta.sha256), size: meta.size, contentType: meta.contentType } : null;
    },
  };
}

/**
 * Pre-flight on the target (§10 step 1): it must be empty, or hold only
 * earlier runs of the same capture and fingerprint. Starts a new run.
 */
export const begin = internalMutation({
  args: { sourceCapture: v.string(), sourceFingerprint: v.string() },
  handler: async (ctx, args) => {
    assertImportAllowed();
    const runs = await ctx.db.query("importRuns").collect();
    const other = runs.find((r) => r.sourceCapture !== args.sourceCapture || r.sourceFingerprint !== args.sourceFingerprint);
    if (other) throw new Error("target holds a run of a different capture or fingerprint; use a fresh target");
    if (runs.length === 0) {
      for (const table of APP_TABLES) {
        if (await ctx.db.query(table).first()) throw new Error(`target is not empty (${table}) and has no earlier run`);
      }
    }
    const running = runs.find((r) => r.status === "running");
    if (running) throw new Error("another run is still marked running; finish or fail it first");
    return await ctx.db.insert("importRuns", { ...args, startedAt: Date.now(), step: "preflight", status: "running", counts: {} });
  },
});

const anyRows = v.array(v.record(v.string(), v.any()));

/** One batch of at most 100 source rows for one step. A changed source row throws, which rolls the batch back. */
export const batch = internalMutation({
  args: { runId: v.id("importRuns"), step: v.string(), rows: anyRows },
  handler: async (ctx, { runId, step, rows }) => {
    assertImportAllowed();
    if (rows.length > 100) throw new Error("batches hold at most 100 rows");
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") throw new Error("run is not running");
    const result = await runBatch(storeFor(ctx, runId), run, step as Step, rows as never);
    const last = rows.length ? String((rows[rows.length - 1] as { sourceId?: string }).sourceId ?? "") : run.cursor;
    const counts = { ...run.counts };
    for (const [k, n] of Object.entries(result)) counts[`${step}.${k}`] = (counts[`${step}.${k}`] ?? 0) + n;
    await ctx.db.patch(runId, { step, cursor: last, counts });
    return result;
  },
});

/** Mapped target IDs for source IDs, so the orchestrator skips uploads it already made. */
export const lookup = internalQuery({
  args: { sourceTable: v.string(), sourceIds: v.array(v.string()) },
  handler: async (ctx, { sourceTable, sourceIds }) => {
    assertImportAllowed();
    const out: Record<string, string> = {};
    for (const sourceId of sourceIds) {
      const hit = await ctx.db.query("importMap").withIndex("by_source", (q) => q.eq("sourceTable", sourceTable).eq("sourceId", sourceId)).unique();
      if (hit) out[sourceId] = hit.targetId;
    }
    return out;
  },
});

export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertImportAllowed();
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Derived values (§10 steps 5 and 6), one page at a time: projects.tagIds,
 * tagCount and both favorite counters from their rows; tags.listedProjectCount
 * from listed projectTags. Recomputed from target rows every time, so a re-run
 * patches nothing.
 */
export const derive = internalMutation({
  args: { runId: v.id("importRuns"), table: v.union(v.literal("projects"), v.literal("tags")), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { runId, table, cursor }) => {
    assertImportAllowed();
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") throw new Error("run is not running");
    let patched = 0;
    if (table === "projects") {
      const page = await ctx.db.query("projects").paginate({ numItems: 100, cursor });
      for (const p of page.page) {
        const links = await ctx.db.query("projectTags").withIndex("by_project_position", (q) => q.eq("projectId", p._id)).collect();
        const favs = await ctx.db.query("favorites").withIndex("by_project_created", (q) => q.eq("projectId", p._id)).collect();
        const d = deriveProject(p.ownerId, links, favs.map((f) => f.userId));
        if (d.tagCount !== p.tagCount || d.favoriteCount !== p.favoriteCount || d.rankingFavoriteCount !== p.rankingFavoriteCount || d.tagIds.join() !== p.tagIds.join()) {
          await ctx.db.patch(p._id, { ...d, tagIds: d.tagIds as Id<"tags">[] });
          patched++;
        }
      }
      return { patched, cursor: page.isDone ? null : page.continueCursor };
    }
    const page = await ctx.db.query("tags").paginate({ numItems: 100, cursor });
    for (const t of page.page) {
      const n = (await ctx.db.query("projectTags").withIndex("by_tag_listed", (q) => q.eq("tagId", t._id).eq("listed", true)).collect()).length;
      if (n !== t.listedProjectCount) {
        await ctx.db.patch(t._id, { listedProjectCount: n });
        patched++;
      }
    }
    return { patched, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const finish = internalMutation({
  args: { runId: v.id("importRuns"), status: v.union(v.literal("complete"), v.literal("failed")), counts: v.record(v.string(), v.number()) },
  handler: async (ctx, { runId, status, counts }) => {
    assertImportAllowed();
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("no such run");
    await ctx.db.patch(runId, { status, step: status, counts: { ...run.counts, ...counts } });
  },
});

/** Every document of every table plus _storage metadata, for reconciliation. The data set is small (P01). */
export const dump = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertImportAllowed();
    const out: Record<string, unknown[]> = {};
    for (const table of [...APP_TABLES, ...IMPORT_TABLES]) out[table] = await ctx.db.query(table).collect();
    out._storage = await ctx.db.system.query("_storage").collect();
    return out;
  },
});
