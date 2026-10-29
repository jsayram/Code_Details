// D00b: source row → import row (P07 §7), canonical keys (§5.2, §5.13, §9) and
// keyed row hashes. Pure apart from node:crypto, so tests run it on synthetic
// rows. Anything that can't be carried over is returned as a FieldReject, never
// dropped silently.
import { createHmac } from "node:crypto";
import { getCategoryFields } from "../../src/constants/project-category-fields";
import { PROJECT_CATEGORIES } from "../../src/constants/project-categories";
import { PROJECT_TEXT_LIMITS } from "../../src/constants/project-limits";
import type { ProjectCategory } from "../../src/constants/project-categories";
import type {
  FavoriteRow, FieldReject, HistoryRow, ImageRow, ProjectRow, ProjectTagRow, TagRow, UserRow,
} from "../../convex/importCore";

// ---- source shapes (columns the orchestrator selects; timestamps as JSON text) ----
export interface SrcProfile {
  id: string; user_id: string; email_address: string; username: string | null; first_name: string | null;
  last_name: string | null; full_name: string | null; tier: string | null; profile_image_url: string | null;
  created_at: string | null; updated_at: string | null; role?: string | null;
}
export interface SrcHistory { old_username: string; user_id: string; new_username: string; changed_at: string | null }
export interface SrcTag { id: string; name: string; description: string | null; created_at: string | null }
export interface SrcProject {
  id: string; title: string; slug: string; description: string | null; created_at: string | null; updated_at: string | null;
  user_id: string; deleted_at: string | null; category: string; url_links: unknown; category_data: unknown; field_order: unknown;
}
export interface SrcProjectTag { project_id: string; tag_id: string; created_at: string | null; tag_name: string }
export interface SrcFavorite { id: string; profile_id: string; project_id: string; created_at: string | null }
export interface SrcImage {
  id: string; project_id: string; storage_path: string; file_name: string; width: number | null; height: number | null;
  image_type: string; display_order: number | null; alt_text: string | null; caption: string | null; uploaded_by: string;
  created_at: string | null; deleted_at: string | null; aspect_ratio: string | null; object_id: string | null;
}

// ---- canonical forms ----
/** §5.2: trim → NFKC → lowercase; must then match USERNAME_RE (ASCII, 3–30). */
export const usernameKey = (s: string) => s.trim().normalize("NFKC").toLowerCase();
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/;
export const isEmailShaped = (s: string) => s.includes("@");
/** §5.13: trim → NFKC → lowercase → collapse internal whitespace. Punctuation stays. */
export const tagNameKey = (s: string) => s.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
/** §9: lowercase NFKC, the same key the fixtures and C09a use. */
export const titleSortKey = (s: string) => s.normalize("NFKC").toLowerCase();
/** §3.3: avatar hosts the target accepts (a host or its subdomain). */
export const AVATAR_HOSTS = ["img.clerk.com", "gravatar.com"];

const opt = (s: string | null | undefined) => (s === null || s === undefined || s.trim() === "" ? undefined : s);

/**
 * Source timestamps to ms since the epoch. timestamptz values carry an
 * offset; `timestamp without time zone` values don't and are read as UTC,
 * which the pre-flight confirms (server TimeZone = UTC). Sub-millisecond
 * digits are dropped on both sides of the reconciliation alike.
 */
export function ms(ts: string | null, fallback?: number): number {
  if (ts === null) {
    if (fallback === undefined) throw new Error("missing timestamp");
    return fallback;
  }
  const hasZone = /(Z|[+-]\d\d(:?\d\d)?)$/.test(ts);
  const t = Date.parse(hasZone ? ts : `${ts}Z`);
  if (Number.isNaN(t)) throw new Error(`unparseable timestamp ${ts}`);
  return t;
}

/** Stable JSON: keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const hmac = (key: Buffer, value: string) => createHmac("sha256", key).update(value).digest("hex");
/** §10 rowHash: keyed, so a hash of a row that holds an email can't be checked against guesses. */
export const rowHash = (key: Buffer, table: string, row: unknown) => hmac(key, `${table}\n${canonicalJson(row)}`);
/** §5.5: the only form an email takes in the target, keyed by the private import key. */
export const emailHmac = (key: Buffer, email: string) => hmac(key, `email\n${email.trim().toLowerCase()}`);

/** §5.2: a generated handle like `user-7f3k2q`, deterministic per source row so re-runs agree. */
export function generatedHandle(key: Buffer, sourceId: string): string {
  const n = BigInt(`0x${hmac(key, `handle\n${sourceId}`).slice(0, 16)}`);
  return `user-${n.toString(36).padStart(6, "0").slice(-6)}`;
}

/** §3.5: a seeded value in [0, 1), so the same capture gives the same order. */
export function shuffleKey(key: Buffer, sourceId: string): number {
  return Number(BigInt(`0x${hmac(key, `shuffle\n${sourceId}`).slice(0, 13)}`)) / 2 ** 52;
}

// ---- row mapping ----
export interface Mapped<R> { row: R | null; rejects: FieldReject[]; notes: string[] }

export function mapTag(key: Buffer, t: SrcTag): Mapped<TagRow> {
  return {
    row: { sourceId: t.id, rowHash: rowHash(key, "tags", t), name: t.name.trim(), nameKey: tagNameKey(t.name), description: opt(t.description), createdAt: ms(t.created_at, 0) },
    rejects: [],
    notes: [],
  };
}

function avatarAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && AVATAR_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function mapProfile(key: Buffer, p: SrcProfile): Mapped<UserRow> {
  const rejects: FieldReject[] = [];
  const notes: string[] = [];
  const raw = p.username ?? "";
  let username = raw.trim();
  let uKey = usernameKey(raw);
  // Email-shaped (Decided, §5.2) or otherwise invalid: a generated handle, no history row, no redirect.
  if (!raw || isEmailShaped(raw) || !USERNAME_RE.test(uKey)) {
    notes.push(!raw ? "username_missing_generated" : isEmailShaped(raw) ? "username_email_shaped_generated" : "username_invalid_generated");
    username = generatedHandle(key, p.id);
    uKey = username;
  }
  let avatarUrl = opt(p.profile_image_url);
  if (avatarUrl && !avatarAllowed(avatarUrl)) {
    rejects.push({ sourceTable: "profiles.profile_image_url", sourceId: p.id, reason: "avatar_host_not_allowed" });
    avatarUrl = undefined;
  }
  const tier = p.tier === "pro" || p.tier === "diamond" ? p.tier : "free";
  if (p.tier !== null && p.tier !== tier) notes.push("tier_unknown_free");
  const createdAt = ms(p.created_at, 0);
  return {
    row: {
      sourceId: p.id, rowHash: rowHash(key, "profiles", p), subject: p.user_id, tier, createdAt,
      emailHmac: emailHmac(key, p.email_address), username, usernameKey: uKey,
      firstName: opt(p.first_name), lastName: opt(p.last_name), fullName: opt(p.full_name), avatarUrl,
      updatedAt: ms(p.updated_at, createdAt),
    },
    rejects,
    notes,
  };
}

/**
 * §5.3: history rows become `previous` claims. The source key is the old
 * username itself, so the import keys it by HMAC instead; an email-shaped or
 * invalid old name gets no row at all (§5.2).
 */
export function mapHistory(key: Buffer, h: SrcHistory): Mapped<HistoryRow> {
  const sourceId = hmac(key, `username_history\n${h.old_username}`);
  const k = usernameKey(h.old_username);
  if (isEmailShaped(h.old_username)) return { row: null, rejects: [{ sourceTable: "username_history", sourceId, reason: "username_email_shaped" }], notes: [] };
  if (!USERNAME_RE.test(k)) return { row: null, rejects: [{ sourceTable: "username_history", sourceId, reason: "username_invalid" }], notes: [] };
  return {
    row: { sourceId, rowHash: rowHash(key, "username_history", h), subject: h.user_id, usernameKey: k, releasedAt: ms(h.changed_at, 0) },
    rejects: [],
    notes: [],
  };
}

const LINK_TYPES = new Set(["repository", "demo", "documentation", "video", "figma", "notion", "slides", "article", "custom"]);
const MAX_LINKS = 10;

/** §7: only http(s) links, known types, label within the app limit. Bad entries are rejected one by one. */
export function mapLinks(projectId: string, links: unknown): { links: ProjectRow["links"]; rejects: FieldReject[] } {
  const out: ProjectRow["links"] = [];
  const rejects: FieldReject[] = [];
  const list = Array.isArray(links) ? links : links === null || links === undefined ? [] : null;
  if (list === null) return { links: [], rejects: [{ sourceTable: "projects.url_links", sourceId: projectId, reason: "links_not_array" }] };
  list.forEach((l, i) => {
    const id = `${projectId}:${i}`;
    const entry = l as { url?: unknown; label?: unknown; type?: unknown };
    let ok = !!l && typeof l === "object" && typeof entry.url === "string";
    if (ok) {
      try {
        ok = ["http:", "https:"].includes(new URL(entry.url as string).protocol);
      } catch {
        ok = false;
      }
    }
    if (!ok) return rejects.push({ sourceTable: "projects.url_links", sourceId: id, reason: "link_url_invalid" });
    if (entry.type !== undefined && !(typeof entry.type === "string" && LINK_TYPES.has(entry.type))) return rejects.push({ sourceTable: "projects.url_links", sourceId: id, reason: "link_type_invalid" });
    if (entry.label !== undefined && !(typeof entry.label === "string" && entry.label.length <= PROJECT_TEXT_LIMITS.MAX_LINK_LABEL_LENGTH)) return rejects.push({ sourceTable: "projects.url_links", sourceId: id, reason: "link_label_invalid" });
    if (out.length >= MAX_LINKS) return rejects.push({ sourceTable: "projects.url_links", sourceId: id, reason: "too_many_links" });
    out.push({ url: entry.url as string, label: opt(entry.label as string | undefined), type: entry.type as string | undefined });
  });
  return { links: out, rejects };
}

/**
 * §7: category data and field order are checked against the category's field
 * definitions. A field the category doesn't define, or a value of the wrong
 * type, is rejected field by field and logged; the rest of the project imports.
 */
export function mapCategoryData(projectId: string, category: string, data: unknown, fieldOrder: unknown): {
  categoryData?: ProjectRow["categoryData"]; fieldOrder?: string[]; rejects: FieldReject[];
} {
  const rejects: FieldReject[] = [];
  const fields = new Map(getCategoryFields(category as ProjectCategory).map((f) => [f.id, f]));
  let categoryData: ProjectRow["categoryData"];
  if (data !== null && data !== undefined) {
    if (typeof data !== "object" || Array.isArray(data)) {
      rejects.push({ sourceTable: "projects.category_data", sourceId: projectId, reason: "category_data_not_object" });
    } else {
      const out: NonNullable<ProjectRow["categoryData"]> = {};
      for (const [k, value] of Object.entries(data as Record<string, unknown>)) {
        const f = fields.get(k);
        const sid = `${projectId}:${k}`;
        if (!f) { rejects.push({ sourceTable: "projects.category_data", sourceId: sid, reason: "category_field_unknown" }); continue; }
        const okType = f.type === "multi-select" ? Array.isArray(value) && value.every((x) => typeof x === "string")
          : f.type === "number" ? typeof value === "number"
          : typeof value === "string";
        if (!okType) { rejects.push({ sourceTable: "projects.category_data", sourceId: sid, reason: "category_field_type" }); continue; }
        out[k] = value as string | number | string[];
      }
      if (Object.keys(out).length) categoryData = out;
    }
  }
  let order: string[] | undefined;
  if (fieldOrder !== null && fieldOrder !== undefined) {
    if (!Array.isArray(fieldOrder)) {
      rejects.push({ sourceTable: "projects.field_order", sourceId: projectId, reason: "field_order_not_array" });
    } else {
      order = [];
      fieldOrder.forEach((k, i) => {
        if (typeof k === "string" && fields.has(k) && !order!.includes(k)) order!.push(k);
        else rejects.push({ sourceTable: "projects.field_order", sourceId: `${projectId}:${i}`, reason: "field_order_unknown" });
      });
      if (!order.length) order = undefined;
    }
  }
  return { categoryData, fieldOrder: order, rejects };
}

/** A project, or a whole-row reject the orchestrator records itself (never in Convex: it has no owner to check). */
export function mapProject(key: Buffer, p: SrcProject): Mapped<ProjectRow> & { rowReject?: string } {
  const createdAt = ms(p.created_at, 0);
  const base = { rejects: [] as FieldReject[], notes: [] as string[] };
  if (!(p.category in PROJECT_CATEGORIES)) return { ...base, row: null, rowReject: "category_unknown" };
  if (!p.title.trim() || p.title.length > PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH) return { ...base, row: null, rowReject: "title_invalid" };
  const links = mapLinks(p.id, p.url_links);
  const cat = mapCategoryData(p.id, p.category, p.category_data, p.field_order);
  return {
    row: {
      sourceId: p.id, rowHash: rowHash(key, "projects", p), ownerSubject: p.user_id, title: p.title, titleSortKey: titleSortKey(p.title),
      slug: p.slug, description: opt(p.description), category: p.category, categoryData: cat.categoryData, fieldOrder: cat.fieldOrder,
      links: links.links, status: p.deleted_at ? "deleted" : "active", deletedAt: p.deleted_at ? ms(p.deleted_at) : undefined,
      shuffleKey: shuffleKey(key, p.id), createdAt, updatedAt: ms(p.updated_at, createdAt),
    },
    rejects: [...links.rejects, ...cat.rejects],
    notes: [],
  };
}

/**
 * §7: the source stores no tag order, so position follows created_at and then
 * tag name (code-point order, the same in both databases, §9).
 */
export function mapProjectTags(key: Buffer, rows: SrcProjectTag[]): ProjectTagRow[] {
  const byProject = new Map<string, SrcProjectTag[]>();
  for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r]);
  const out: ProjectTagRow[] = [];
  for (const list of byProject.values()) {
    list.sort((a, b) => ms(a.created_at, 0) - ms(b.created_at, 0) || (a.tag_name < b.tag_name ? -1 : a.tag_name > b.tag_name ? 1 : 0));
    list.forEach((r, position) => {
      const source = { project_id: r.project_id, tag_id: r.tag_id, created_at: r.created_at };
      out.push({ sourceId: `${r.project_id}:${r.tag_id}`, rowHash: rowHash(key, "project_tags", source), projectSourceId: r.project_id, tagSourceId: r.tag_id, position });
    });
  }
  return out.sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));
}

export function mapFavorite(key: Buffer, f: SrcFavorite): FavoriteRow {
  return { sourceId: f.id, rowHash: rowHash(key, "favorites", f), profileSourceId: f.profile_id, projectSourceId: f.project_id, createdAt: ms(f.created_at, 0) };
}

/** Display name only: the last path segment, no control characters, at most 255 characters. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "image").slice(0, 255);
}

const IMAGE_KINDS = new Set(["cover", "screenshot", "diagram", "logo"]);

export function mapImage(key: Buffer, i: SrcImage): Mapped<ImageRow> & { rowReject?: string } {
  const base = { rejects: [] as FieldReject[], notes: [] as string[] };
  if (!IMAGE_KINDS.has(i.image_type)) return { ...base, row: null, rowReject: "image_kind_invalid" };
  if (!i.object_id) return { ...base, row: null, rowReject: "file_missing" };
  const source: Partial<SrcImage> = { ...i };
  delete source.object_id;
  return {
    ...base,
    row: {
      sourceId: i.id, rowHash: rowHash(key, "project_images", source), projectSourceId: i.project_id, uploaderSubject: i.uploaded_by,
      objectSourceId: i.object_id, kind: i.image_type as ImageRow["kind"], displayOrder: i.display_order ?? 0,
      altText: opt(i.alt_text), caption: opt(i.caption), width: i.width ?? undefined, height: i.height ?? undefined,
      aspectRatio: opt(i.aspect_ratio), fileName: sanitizeFileName(i.file_name), status: i.deleted_at ? "deleted" : "active",
      deletedAt: i.deleted_at ? ms(i.deleted_at) : undefined, createdAt: ms(i.created_at, 0),
    },
  };
}
