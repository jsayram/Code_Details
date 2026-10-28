// Public project read contract (Phase C, C02/C04). Backend-independent: the
// Supabase and Convex readers both return exactly this shape, and the project
// page only ever renders it for anonymous visitors. The contract follows the
// P07 §5.14/§8 projection: the owner is identified by username only (plus the
// public profile names and avatar), never by email, provider subject, profile
// UUID or tier. Private and deleted projects are not representable here; a
// reader returns null for them, the same as for a slug that doesn't exist.

export const PUBLIC_PROJECT_VERSION = 1;

export interface PublicProjectLink {
  url: string;
  label?: string;
  type?: string;
}

export interface PublicProjectOwner {
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface PublicProject {
  /** Opaque project ID of the backend that served it. */
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  /** Tag names in display order. */
  tags: string[];
  links: PublicProjectLink[];
  /** Only the keys listed in fieldOrder (the fields the page displays). */
  categoryData: Record<string, unknown> | null;
  fieldOrder: string[] | null;
  /** Every favorite, the owner's own included. rankingFavoriteCount is never public. */
  favoriteCount: number;
  visibility: "public";
  listed: true;
  /** ISO 8601, UTC. */
  createdAt: string | null;
  updatedAt: string | null;
  /** Null when the owner has no public profile (orphaned project). */
  owner: PublicProjectOwner | null;
}

export const PUBLIC_PROJECT_KEYS = [
  "id", "slug", "title", "description", "category", "tags", "links", "categoryData", "fieldOrder",
  "favoriteCount", "visibility", "listed", "createdAt", "updatedAt", "owner",
] as const;
export const PUBLIC_OWNER_KEYS = ["username", "fullName", "avatarUrl"] as const;
const LINK_KEYS = new Set(["url", "label", "type"]);

/** Keeps only the category fields the page shows (fieldOrder). */
export function publicCategoryData(
  data: Record<string, unknown> | null | undefined,
  fieldOrder: string[] | null | undefined,
): Record<string, unknown> | null {
  if (!data || !fieldOrder) return null;
  const out: Record<string, unknown> = {};
  for (const key of fieldOrder) if (Object.hasOwn(data, key)) out[key] = data[key];
  return Object.keys(out).length ? out : null;
}

export function publicLinks(links: unknown): PublicProjectLink[] {
  if (!Array.isArray(links)) return [];
  return links
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && typeof (l as { url?: unknown }).url === "string")
    .map((l) => {
      const link: PublicProjectLink = { url: l.url as string };
      if (typeof l.label === "string") link.label = l.label;
      if (typeof l.type === "string") link.type = l.type;
      return link;
    });
}

const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;
const PROVIDER_SUBJECT = /\buser_[A-Za-z0-9_]+/;

/**
 * Throws unless value is exactly a PublicProject: no extra keys anywhere, and
 * no email- or provider-subject-shaped ID or owner field. Readers run
 * this before returning, so a leak fails loudly instead of reaching the HTML.
 */
export function assertPublicProject(value: unknown): asserts value is PublicProject {
  const problems: string[] = [];
  const check = (obj: Record<string, unknown>, allowed: readonly string[], where: string) => {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) problems.push(`${where}.${key} is not public`);
    for (const key of allowed) if (!Object.hasOwn(obj, key)) problems.push(`${where}.${key} is missing`);
  };
  if (!value || typeof value !== "object") throw new Error("public project: not an object");
  const p = value as Record<string, unknown>;
  check(p, PUBLIC_PROJECT_KEYS, "project");
  if (p.visibility !== "public") problems.push("project.visibility must be public");
  if (p.listed !== true) problems.push("project.listed must be true");
  if (typeof p.favoriteCount !== "number" || !Number.isFinite(p.favoriteCount)) problems.push("project.favoriteCount must be a number");
  if (!Array.isArray(p.tags) || p.tags.some((t) => typeof t !== "string")) problems.push("project.tags must be strings");
  if (!Array.isArray(p.links)) problems.push("project.links must be an array");
  else for (const link of p.links as Record<string, unknown>[]) {
    for (const key of Object.keys(link)) if (!LINK_KEYS.has(key)) problems.push(`project.links[].${key} is not public`);
  }
  if (p.owner !== null) {
    if (!p.owner || typeof p.owner !== "object") problems.push("project.owner must be an object or null");
    else check(p.owner as Record<string, unknown>, PUBLIC_OWNER_KEYS, "owner");
  }
  // Only identity-bearing fields are scanned; titles and descriptions are the
  // creator's own text and may legitimately mention an address.
  const scan = (v: unknown, path: string) => {
    if (typeof v !== "string") return;
    if (EMAIL.test(v) && !/^https?:\/\//.test(v)) problems.push(`${path} contains an email address`);
    if (PROVIDER_SUBJECT.test(v)) problems.push(`${path} contains a provider subject`);
  };
  scan(p.id, "project.id");
  if (p.owner && typeof p.owner === "object") {
    for (const [k, v] of Object.entries(p.owner)) scan(v, `owner.${k}`);
  }
  if (problems.length) throw new Error(`public project contract violated:\n- ${problems.join("\n- ")}`);
}
