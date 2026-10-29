// D00b: the import's decision logic (P07 §10), kept free of Convex so unit
// tests can run it against an in-memory store with synthetic data. The only
// caller in Convex is convex/importer.ts, which backs ImportStore with ctx.db.
// No functions are registered here.
//
// Every row carries the source ID and a keyed hash of the canonical source
// row (computed by scripts/d00b-import/mapping.ts). For each row, in order:
//   - mapped in importMap with the same hash: skip (a re-run is idempotent);
//   - mapped with a different hash: stop the run (the source changed);
//   - a relationship that doesn't resolve, or a canonical key that's taken:
//     record an importReject and go on. Rows are never merged or reassigned.
//   - otherwise insert and map.

export const DAY_MS = 24 * 60 * 60 * 1000;
/** §5.3: an imported previous username stays reserved for 90 days from the import. */
export const USERNAME_RESERVATION_MS = 90 * DAY_MS;
/** §3.5: projects carry at most 15 tags. */
export const MAX_TAGS = 15;

export type Step = "tags" | "users" | "usernameHistory" | "projects" | "projectTags" | "favorites" | "files" | "images" | "fieldRejects";

/** Source table each step reads; importMap.sourceTable and importRejects.sourceTable. */
export const SOURCE_TABLE: Record<Exclude<Step, "fieldRejects">, string> = {
  tags: "tags",
  users: "profiles",
  usernameHistory: "username_history",
  projects: "projects",
  projectTags: "project_tags",
  favorites: "favorites",
  files: "storage.objects",
  images: "project_images",
};

interface Base { sourceId: string; rowHash: string }

export interface TagRow extends Base { name: string; nameKey: string; description?: string; createdAt: number }
export interface UserRow extends Base {
  subject: string;
  tier: "free" | "pro" | "diamond";
  createdAt: number;
  /** §5.5: HMAC of the lowercased email; the email itself never reaches Convex. */
  emailHmac: string;
  username: string;
  usernameKey: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  avatarUrl?: string;
  updatedAt: number;
}
export interface HistoryRow extends Base { subject: string; usernameKey: string; releasedAt: number }
export interface ProjectRow extends Base {
  ownerSubject: string;
  title: string;
  titleSortKey: string;
  slug: string;
  description?: string;
  category: string;
  categoryData?: Record<string, string | number | boolean | string[]>;
  fieldOrder?: string[];
  links: { url: string; label?: string; type?: string }[];
  status: "active" | "deleted";
  deletedAt?: number;
  shuffleKey: number;
  createdAt: number;
  updatedAt: number;
}
export interface ProjectTagRow extends Base { projectSourceId: string; tagSourceId: string; position: number }
export interface FavoriteRow extends Base { profileSourceId: string; projectSourceId: string; createdAt: number }
export interface FileRow extends Base { storageId: string; sha256Hex: string; size: number }
export interface ImageRow extends Base {
  projectSourceId: string;
  uploaderSubject: string;
  objectSourceId: string;
  kind: "cover" | "screenshot" | "diagram" | "logo";
  displayOrder: number;
  altText?: string;
  caption?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  fileName: string;
  status: "active" | "deleted";
  deletedAt?: number;
  createdAt: number;
}
/** A reject decided in the orchestrator (a dropped link or category field, an email-shaped history name). */
export interface FieldReject { sourceTable: string; sourceId: string; reason: string }

export type RowFor<S extends Step> = S extends "tags" ? TagRow
  : S extends "users" ? UserRow
  : S extends "usernameHistory" ? HistoryRow
  : S extends "projects" ? ProjectRow
  : S extends "projectTags" ? ProjectTagRow
  : S extends "favorites" ? FavoriteRow
  : S extends "files" ? FileRow
  : S extends "images" ? ImageRow
  : FieldReject;

type Doc = Record<string, unknown>;

/** What the batch logic needs from the target. Every lookup sees this batch's own earlier writes. */
export interface ImportStore {
  mapped(sourceTable: string, sourceId: string): Promise<{ targetId: string; rowHash: string } | null>;
  map(sourceTable: string, sourceId: string, targetTable: string, targetId: string, rowHash: string): Promise<void>;
  /** The reason this run already rejected the row for, or null. */
  rejectedReason(sourceTable: string, sourceId: string): Promise<string | null>;
  reject(sourceTable: string, sourceId: string, reason: string): Promise<void>;
  insert(table: string, doc: Doc): Promise<string>;
  get(table: string, id: string): Promise<Doc | null>;
  userBySubject(subject: string): Promise<string | null>;
  tagByNameKey(nameKey: string): Promise<string | null>;
  /** Any profile or usernames row (current or previous) holding the key. */
  usernameHolder(usernameKey: string): Promise<string | null>;
  slugHolder(slug: string): Promise<string | null>;
  favoriteExists(userId: string, projectId: string): Promise<boolean>;
  projectTagCount(projectId: string): Promise<number>;
  projectTagExists(projectId: string, tagId: string): Promise<boolean>;
  storageMeta(storageId: string): Promise<{ sha256Hex: string; size: number; contentType?: string } | null>;
}

export interface BatchResult { inserted: number; skipped: number; rejected: number }

export class SourceChangedError extends Error {
  constructor(sourceTable: string, sourceId: string) {
    super(`source row changed since it was imported (${sourceTable} ${sourceId}); start a new run against a new target`);
    this.name = "SourceChangedError";
  }
}

/** Resolve a parent row through importMap; when it isn't mapped, say whether it was rejected or never existed. */
async function resolve(store: ImportStore, sourceTable: string, sourceId: string, missing: string): Promise<{ id: string } | { reason: string }> {
  const hit = await store.mapped(sourceTable, sourceId);
  if (hit) return { id: hit.targetId };
  const rejected = await store.rejectedReason(sourceTable, sourceId);
  return { reason: rejected ? `${missing.replace(/_missing$/, "")}_rejected` : missing };
}

export async function runBatch<S extends Step>(store: ImportStore, run: { startedAt: number }, step: S, rows: RowFor<S>[]): Promise<BatchResult> {
  const result: BatchResult = { inserted: 0, skipped: 0, rejected: 0 };
  if (step === "fieldRejects") {
    for (const r of rows as FieldReject[]) {
      if (await store.rejectedReason(r.sourceTable, r.sourceId)) { result.skipped++; continue; }
      await store.reject(r.sourceTable, r.sourceId, r.reason);
      result.rejected++;
    }
    return result;
  }
  const sourceTable = SOURCE_TABLE[step as Exclude<Step, "fieldRejects">];
  for (const row of rows as unknown as (Base & Doc)[]) {
    const prior = await store.mapped(sourceTable, row.sourceId);
    if (prior) {
      if (prior.rowHash !== row.rowHash) throw new SourceChangedError(sourceTable, row.sourceId);
      result.skipped++;
      continue;
    }
    const reason = await importRow(store, run, step, row as never);
    if (reason) {
      await store.reject(sourceTable, row.sourceId, reason);
      result.rejected++;
    } else {
      result.inserted++;
    }
  }
  return result;
}

/** Inserts one row and its map entries, or returns the reject reason. Checks run before any write. */
async function importRow(store: ImportStore, run: { startedAt: number }, step: Step, row: never): Promise<string | null> {
  switch (step) {
    case "tags": {
      const r = row as TagRow;
      if (await store.tagByNameKey(r.nameKey)) return "duplicate_tag_name";
      const id = await store.insert("tags", { name: r.name, nameKey: r.nameKey, description: r.description, status: "active", listedProjectCount: 0, createdAt: r.createdAt });
      await store.map("tags", r.sourceId, "tags", id, r.rowHash);
      return null;
    }
    case "users": {
      const r = row as UserRow;
      if (await store.userBySubject(r.subject)) return "duplicate_subject";
      if (await store.usernameHolder(r.usernameKey)) return "duplicate_username";
      const userId = await store.insert("users", { role: "user", tier: r.tier, status: "active", createdAt: r.createdAt });
      await store.insert("authLinks", { userId, provider: "clerk", subject: r.subject, linkedAt: r.createdAt });
      await store.insert("profiles", {
        userId, username: r.username, usernameKey: r.usernameKey, firstName: r.firstName, lastName: r.lastName, fullName: r.fullName,
        avatar: r.avatarUrl ? { kind: "external", url: r.avatarUrl } : undefined, createdAt: r.createdAt, updatedAt: r.updatedAt,
      });
      await store.insert("usernames", { usernameKey: r.usernameKey, userId, state: "current", claimedAt: r.createdAt });
      await store.map("profiles", r.sourceId, "users", userId, r.rowHash);
      await store.map("profiles.email", r.sourceId, "users", userId, r.emailHmac);
      return null;
    }
    case "usernameHistory": {
      const r = row as HistoryRow;
      const userId = await store.userBySubject(r.subject);
      if (!userId) return "user_missing";
      const holder = await store.usernameHolder(r.usernameKey);
      if (holder && holder !== userId) return "username_conflict";
      const user = await store.get("users", userId);
      const id = await store.insert("usernames", {
        usernameKey: r.usernameKey, userId, state: "previous", claimedAt: user!.createdAt as number,
        releasedAt: r.releasedAt, reservedUntil: run.startedAt + USERNAME_RESERVATION_MS,
      });
      await store.map("username_history", r.sourceId, "usernames", id, r.rowHash);
      return null;
    }
    case "projects": {
      const r = row as ProjectRow;
      const ownerId = await store.userBySubject(r.ownerSubject);
      if (!ownerId) return "owner_missing";
      if (await store.slugHolder(r.slug)) return "duplicate_slug";
      const listed = r.status === "active";
      const id = await store.insert("projects", {
        ownerId, title: r.title, titleSortKey: r.titleSortKey, slug: r.slug, description: r.description, category: r.category,
        categoryData: r.categoryData, fieldOrder: r.fieldOrder, links: r.links, visibility: "public", status: r.status,
        deletedAt: r.deletedAt, listed, tagIds: [], tagCount: 0, favoriteCount: 0, rankingFavoriteCount: 0, contentVersion: 1,
        shuffleKey: r.shuffleKey, createdAt: r.createdAt, updatedAt: r.updatedAt,
      });
      await store.insert("projectSlugs", { slug: r.slug, projectId: id, state: "current", createdAt: r.createdAt });
      await store.map("projects", r.sourceId, "projects", id, r.rowHash);
      return null;
    }
    case "projectTags": {
      const r = row as ProjectTagRow;
      const project = await resolve(store, "projects", r.projectSourceId, "project_missing");
      if ("reason" in project) return project.reason;
      const tag = await resolve(store, "tags", r.tagSourceId, "tag_missing");
      if ("reason" in tag) return tag.reason;
      if (await store.projectTagExists(project.id, tag.id)) return "duplicate_project_tag";
      if ((await store.projectTagCount(project.id)) >= MAX_TAGS) return "too_many_tags";
      const p = await store.get("projects", project.id);
      const id = await store.insert("projectTags", { projectId: project.id, tagId: tag.id, position: r.position, listed: p!.listed as boolean });
      await store.map("project_tags", r.sourceId, "projectTags", id, r.rowHash);
      return null;
    }
    case "favorites": {
      const r = row as FavoriteRow;
      const user = await resolve(store, "profiles", r.profileSourceId, "user_missing");
      if ("reason" in user) return user.reason;
      const project = await resolve(store, "projects", r.projectSourceId, "project_missing");
      if ("reason" in project) return project.reason;
      if (await store.favoriteExists(user.id, project.id)) return "duplicate_favorite";
      const p = await store.get("projects", project.id);
      const id = await store.insert("favorites", { userId: user.id, projectId: project.id, createdAt: r.createdAt, listed: p!.listed as boolean });
      await store.map("favorites", r.sourceId, "favorites", id, r.rowHash);
      return null;
    }
    case "files": {
      const r = row as FileRow;
      const meta = await store.storageMeta(r.storageId);
      if (!meta) return "file_missing";
      // A mismatch means the upload is corrupt, not that the data is odd: stop.
      if (meta.sha256Hex !== r.sha256Hex || meta.size !== r.size) throw new Error(`uploaded file ${r.sourceId} doesn't match the capture (SHA-256 or size)`);
      await store.map("storage.objects", r.sourceId, "_storage", r.storageId, r.rowHash);
      return null;
    }
    case "images": {
      const r = row as ImageRow;
      const project = await resolve(store, "projects", r.projectSourceId, "project_missing");
      if ("reason" in project) return project.reason;
      const uploader = await store.userBySubject(r.uploaderSubject);
      if (!uploader) return "uploader_missing";
      const file = await resolve(store, "storage.objects", r.objectSourceId, "file_missing");
      if ("reason" in file) return file.reason;
      const p = await store.get("projects", project.id);
      // §3.10: private projects get no images until an access-checked route exists.
      if (p!.visibility !== "public") return "private_project_image";
      const meta = await store.storageMeta(file.id);
      const id = await store.insert("projectImages", {
        projectId: project.id, storageId: file.id, kind: r.kind, displayOrder: r.displayOrder, altText: r.altText, caption: r.caption,
        width: r.width, height: r.height, aspectRatio: r.aspectRatio, fileName: r.fileName,
        mimeType: meta!.contentType ?? "application/octet-stream", size: meta!.size, uploadedBy: uploader,
        status: r.status, deletedAt: r.deletedAt, createdAt: r.createdAt,
      });
      await store.map("project_images", r.sourceId, "projectImages", id, r.rowHash);
      return null;
    }
    default:
      throw new Error(`unknown step ${step}`);
  }
}

/** §3.5/§5.10: a project's derived fields from its tag links and favorites. */
export function deriveProject(ownerId: string, tagLinks: { tagId: string; position: number }[], favoriteUserIds: string[]) {
  const tagIds = [...tagLinks].sort((a, b) => a.position - b.position).map((t) => t.tagId);
  return {
    tagIds,
    tagCount: tagIds.length,
    favoriteCount: favoriteUserIds.length,
    rankingFavoriteCount: favoriteUserIds.filter((u) => u !== ownerId).length,
  };
}
