// D00a: convex/schema.ts is the full P07 model (§3) and follows its
// conventions (§6). The first half reads the schema file itself, so it runs
// without a backend. The second half asks the task-owned local backend to
// evaluate the schema against the synthetic fixtures (`push.mjs --dry-run`,
// nothing committed): it must pass, and a schema the fixtures violate must
// be refused, so a green push really means existing documents were checked.
// D00b promoted D00a's one staged validator (tags.listedProjectCount), so
// no staged validators remain.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";

type FieldJson = { fieldType: { type: string; tableName?: string; [k: string]: unknown }; optional: boolean };
type ObjectJson = { type: "object"; value: Record<string, FieldJson> };
type TableJson = {
  tableName: string;
  indexes: { indexDescriptor: string; fields: string[] }[];
  stagedDbIndexes: unknown[];
  searchIndexes: unknown[];
  stagedSearchIndexes: unknown[];
  vectorIndexes: unknown[];
  documentType: ObjectJson;
  stagedDocumentType?: ObjectJson;
};
// export() is what the CLI sends on push; it is marked internal in the types.
const exported = JSON.parse((schema as unknown as { export(): string }).export()) as { tables: TableJson[]; schemaValidation: boolean };
const tables = new Map(exported.tables.map((t) => [t.tableName, t]));

// P07 §3, table by table: every field and every index (name and fields).
// Additions P07 doesn't list are marked and explained in D00A_REPORT.md.
const P07: Record<string, { fields: string[]; indexes: Record<string, string[]> }> = {
  users: {
    fields: ["authUserId", "role", "tier", "status", "createdAt", "deletionRequestedAt", "deleteAfter"],
    indexes: { by_authUserId: ["authUserId"], by_status_deleteAfter: ["status", "deleteAfter"] },
  },
  authLinks: {
    fields: ["userId", "provider", "subject", "linkedAt"],
    indexes: { by_provider_subject: ["provider", "subject"], by_user: ["userId"] },
  },
  profiles: {
    fields: ["userId", "username", "usernameKey", "firstName", "lastName", "fullName", "avatar", "createdAt", "updatedAt"],
    indexes: { by_userId: ["userId"], by_usernameKey: ["usernameKey"] },
  },
  usernames: {
    fields: ["usernameKey", "userId", "state", "claimedAt", "releasedAt", "reservedUntil"],
    indexes: {
      by_usernameKey_state: ["usernameKey", "state"],
      by_userId_state: ["userId", "state"],
      by_state_reservedUntil: ["state", "reservedUntil"],
    },
  },
  projects: {
    fields: [
      "ownerId", "title", "titleSortKey", "slug", "description", "category", "categoryData", "categoryDataVersion",
      "fieldOrder", "links", "visibility", "status", "deletedAt", "listed", "tagIds", "tagCount", "favoriteCount",
      "rankingFavoriteCount", "contentVersion", "shuffleKey", "searchText", "createdAt", "updatedAt",
    ],
    indexes: {
      by_slug: ["slug"],
      by_owner_status_created: ["ownerId", "status", "createdAt"],
      by_owner_listed_created: ["ownerId", "listed", "createdAt"],
      by_owner_listed_ranking: ["ownerId", "listed", "rankingFavoriteCount"],
      by_listed_created: ["listed", "createdAt"],
      by_listed_updated: ["listed", "updatedAt"],
      by_listed_ranking: ["listed", "rankingFavoriteCount"],
      by_listed_title: ["listed", "titleSortKey"],
      by_listed_tagCount: ["listed", "tagCount"],
      by_listed_shuffle: ["listed", "shuffleKey"],
      by_listed_category_created: ["listed", "category", "createdAt"],
      by_listed_category_ranking: ["listed", "category", "rankingFavoriteCount"],
    },
  },
  projectSlugs: {
    fields: ["slug", "projectId", "state", "createdAt"],
    indexes: { by_slug: ["slug"], by_project_state: ["projectId", "state"] },
  },
  tags: {
    fields: ["name", "nameKey", "description", "status", "listedProjectCount", "createdAt"],
    indexes: { by_nameKey: ["nameKey"], by_status_name: ["status", "nameKey"], by_status_count: ["status", "listedProjectCount"] },
  },
  tagAliases: {
    fields: ["aliasKey", "tagId", "reviewedBy", "reviewedAt"],
    indexes: { by_aliasKey: ["aliasKey"] },
  },
  projectTags: {
    fields: ["projectId", "tagId", "position", "listed"],
    indexes: {
      by_project_position: ["projectId", "position"],
      by_project_tag: ["projectId", "tagId"],
      by_tag_listed: ["tagId", "listed"],
    },
  },
  favorites: {
    fields: ["userId", "projectId", "createdAt", "listed"],
    indexes: {
      by_user_project: ["userId", "projectId"],
      by_user_listed_created: ["userId", "listed", "createdAt"],
      by_project_created: ["projectId", "createdAt"],
    },
  },
  projectImages: {
    fields: [
      "projectId", "storageId", "kind", "displayOrder", "altText", "caption", "width", "height", "aspectRatio",
      "fileName", "mimeType", "size", "uploadedBy", "status", "deletedAt", "createdAt",
    ],
    indexes: {
      by_project_status_order: ["projectId", "status", "displayOrder"],
      by_project_kind_status: ["projectId", "kind", "status"],
      by_storageId: ["storageId"],
    },
  },
  tagSuggestions: {
    fields: [
      "projectId", "submitterId", "proposedName", "nameKey", "note", "status", "resolvedTagId", "reviewerId",
      "reviewedAt", "adminNotes", "createdAt",
    ],
    indexes: {
      by_status_created: ["status", "createdAt"],
      by_project_status: ["projectId", "status"],
      by_project_nameKey: ["projectId", "nameKey"],
      by_submitter_created: ["submitterId", "createdAt"],
    },
  },
  auditEvents: {
    fields: ["kind", "actorId", "subjectTable", "subjectId", "at", "details"],
    indexes: { by_subject: ["subjectTable", "subjectId"], by_at: ["at"] },
  },
  contentChanges: {
    fields: ["entityType", "entityId", "change", "sourceVersion", "projectionVersion", "createdAt", "processedAt", "attempts"],
    indexes: { by_processed_created: ["processedAt", "createdAt"], by_entity: ["entityType", "entityId"] },
  },
  // `cursor`: §10's per-step resume position, which §3.15's field list leaves out.
  importRuns: {
    fields: ["sourceCapture", "sourceFingerprint", "startedAt", "step", "cursor", "status", "counts"],
    indexes: {},
  },
  importMap: {
    fields: ["runId", "sourceTable", "sourceId", "targetTable", "targetId", "rowHash"],
    indexes: { by_source: ["sourceTable", "sourceId"], by_run: ["runId"] },
  },
  importRejects: {
    fields: ["runId", "sourceTable", "sourceId", "reason"],
    indexes: { by_run: ["runId"] },
  },
  // D08 /api/llm gate (Jose, 2026-10-30): persistent daily caps and the call log (no prompts).
  llmDailyUsage: {
    fields: ["day", "scope", "count"],
    indexes: { by_day_scope: ["day", "scope"] },
  },
  llmCalls: {
    fields: ["userId", "day", "startedAt", "provider", "model", "status", "latencyMs", "errorStatus"],
    indexes: { by_user_day: ["userId", "day"] },
  },
  // D10 day one (§3.14, D09 S02d): search analytics, no user ID, email or IP.
  searchReceipts: {
    fields: ["receiptId", "visit", "query", "scope", "hits", "createdAt", "expiresAt"],
    indexes: { by_receiptId: ["receiptId"], by_expires: ["expiresAt"] },
  },
  searchEvents: {
    fields: [
      "eventId", "type", "channel", "day", "acceptedAt", "clientAt", "skewed", "receiptId", "visit", "interactionId", "product",
      "query", "scope", "sort", "filterCount", "page", "status", "hitCount", "zero", "low", "latencyMs", "entityId", "position", "positions",
    ],
    indexes: { by_eventId: ["eventId"], by_day: ["day"], by_accepted: ["acceptedAt"], by_receipt_type: ["receiptId", "type"] },
  },
  searchDaily: {
    fields: ["day", "query", "scope", "channel", "searches", "requests", "zeroResults", "lowResults", "errors", "presented", "clickedSearches", "clicks", "favorites", "browses", "updatedAt"],
    indexes: { by_day: ["day"] },
  },
  searchDrops: {
    fields: ["day", "reason", "count"],
    indexes: { by_day_reason: ["day", "reason"] },
  },
};

/** Every validator node under a field, depth first. */
function nodes(t: FieldJson["fieldType"]): FieldJson["fieldType"][] {
  const out = [t];
  const kids: unknown[] = [];
  if (t.type === "union") kids.push(...(t.value as unknown[]));
  if (t.type === "array") kids.push(t.value);
  if (t.type === "object") kids.push(...Object.values(t.value as Record<string, FieldJson>).map((f) => f.fieldType));
  if (t.type === "record") kids.push((t.values as FieldJson).fieldType);
  for (const k of kids) out.push(...nodes(k as FieldJson["fieldType"]));
  return out;
}

describe("D00a schema matches P07 §3 and §6", () => {
  it("has exactly the P07 tables, no more", () => {
    expect([...tables.keys()].sort()).toEqual(Object.keys(P07).sort());
  });

  it.each(Object.entries(P07))("%s has the P07 fields and indexes", (name, spec) => {
    const t = tables.get(name)!;
    expect(Object.keys(t.documentType.value).sort()).toEqual([...spec.fields].sort());
    expect(Object.fromEntries(t.indexes.map((i) => [i.indexDescriptor, i.fields]))).toEqual(spec.indexes);
  });

  it("stays inside the Convex index limits (32 per table, 16 fields per index)", () => {
    for (const t of tables.values()) {
      expect(t.indexes.length).toBeLessThanOrEqual(32);
      for (const i of t.indexes) expect(i.fields.length).toBeLessThanOrEqual(16);
    }
  });

  it("keeps schema validation on; the only search index is D09's search_public, and no vector or staged indexes", () => {
    expect(exported.schemaValidation).toBe(true);
    for (const [name, t] of tables) {
      expect([t.stagedSearchIndexes, t.vectorIndexes, t.stagedDbIndexes]).toEqual([[], [], []]);
      expect(t.searchIndexes).toEqual(
        name === "projects"
          ? [{ indexDescriptor: "search_public", searchField: "searchText", filterFields: ["listed", "category", "ownerId"] }]
          : [],
      );
    }
  });

  it("never stores null and never accepts any (§6)", () => {
    for (const t of tables.values()) {
      for (const [field, f] of Object.entries(t.documentType.value)) {
        const types = nodes(f.fieldType).map((n) => n.type);
        expect(types, `${t.tableName}.${field}`).not.toContain("null");
        expect(types, `${t.tableName}.${field}`).not.toContain("any");
      }
    }
  });

  it("points every Id at a table in this schema or at _storage", () => {
    for (const t of tables.values()) {
      for (const f of Object.values(t.documentType.value)) {
        for (const n of nodes(f.fieldType).filter((n) => n.type === "id")) {
          expect(n.tableName === "_storage" || tables.has(n.tableName!), `${t.tableName} -> ${n.tableName}`).toBe(true);
        }
      }
    }
  });

  // D00b promoted the one staged tightening D00a had (tags.listedProjectCount).
  it("has no staged validators left; tags.listedProjectCount is required", () => {
    expect(exported.tables.filter((t) => t.stagedDocumentType).map((t) => t.tableName)).toEqual([]);
    expect(tables.get("tags")!.documentType.value.listedProjectCount).toEqual({ fieldType: { type: "number" }, optional: false });
  });
});

const root = path.resolve(__dirname, "../..");

/** `push.mjs --dry-run`: the backend evaluates the schema, nothing is committed. */
function dryRun(projectDir?: string): { status: number | null; output: string } {
  const args = [path.join(root, "tests/convex/push.mjs"), "--dry-run", ...(projectDir ? ["--project-dir", projectDir] : [])];
  const r = spawnSync(process.execPath, args, { cwd: root, env: process.env, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

/** A throwaway copy of the project whose schema has one edit applied. */
function projectWithSchema(edit: (schemaSource: string) => string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d00a-schema-"));
  for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.cpSync(path.join(root, "convex"), path.join(dir, "convex"), { recursive: true });
  // convex/projects.ts imports the C02 contract from src/.
  for (const d of ["node_modules", "src"]) fs.symlinkSync(path.join(root, d), path.join(dir, d));
  const file = path.join(dir, "convex/schema.ts");
  const source = fs.readFileSync(file, "utf8");
  const next = edit(source);
  if (next === source) throw new Error("schema edit did not apply");
  fs.writeFileSync(file, next);
  return dir;
}

describe.skipIf(!convexAvailable())("D00a schema on the task-owned local backend", () => {
  const temp: string[] = [];

  beforeAll(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures();
  });

  afterAll(async () => {
    await clearConvexFixtures();
    for (const d of temp) fs.rmSync(d, { recursive: true, force: true });
  });

  it("pushes against the loaded fixtures: validation passes", () => {
    const r = dryRun();
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("Schema validation complete.");
  });

  it("refuses a schema the fixtures violate (searchText made required)", () => {
    const dir = projectWithSchema((s) => s.replace("searchText: v.optional(v.string()),", "searchText: v.string(),"));
    temp.push(dir);
    const r = dryRun(dir);
    expect(r.status, r.output).not.toBe(0);
    expect(r.output).toMatch(/projects/);
    expect(r.output).toMatch(/searchText/);
  });
});
