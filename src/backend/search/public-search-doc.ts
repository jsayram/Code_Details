// D09 S00.2: the public search projection (P07 §5.14), one versioned pure
// function. Backend-independent: no Convex, Next or database imports, so the
// Code Details adapter, a native Convex index and an external engine can all
// build the same document. Nothing imports this yet; S02 wires it.
//
// Eligibility is the public-list rule (isPublic in convex/projects.ts):
// listed, active and public. Anything else has no search document at all, so
// a private or deleted project can't reach a hit, a count or a suggestion.
// The owner is a username and display name only, never an email, provider
// subject or user ID. Tags are the active ones; retired tags and pending
// suggestions never enter the text or the facets.

import { publicCategoryData } from "../projects/public-project";

export const SEARCH_PROJECTION_VERSION = 1;

/** searchText is cut to this many characters so one project can't blow up an index entry. */
export const MAX_SEARCH_TEXT = 4000;

export interface SearchSourceProject {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  categoryData?: Record<string, unknown> | null;
  fieldOrder?: string[] | null;
  visibility: "public" | "private";
  status: "active" | "deleted";
  listed: boolean;
  favoriteCount: number;
  rankingFavoriteCount: number;
  contentVersion: number;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

export interface SearchSourceOwner {
  username: string;
  fullName?: string | null;
}

export interface SearchSourceTag {
  id: string;
  name: string;
  status: "active" | "retired";
}

export interface PublicSearchDoc {
  entityType: "project";
  /** Opaque ID of the source backend. */
  entityId: string;
  /** Canonical app route. */
  route: string;
  title: string;
  description: string | null;
  category: string;
  /** Active tags in the project's order. */
  tags: { id: string; name: string }[];
  /** Only the fields the project page shows (fieldOrder). */
  categoryData: Record<string, unknown> | null;
  /** Null when the owner has no public profile. */
  owner: { username: string; fullName: string | null } | null;
  favoriteCount: number;
  createdAt: number;
  updatedAt: number;
  /** The text a keyword index matches against: title, description, tags, category, owner names. */
  searchText: string;
  /** Ranking inputs. Server-side only: never returned in a hit or shipped in a browser snapshot. */
  ranking: { favorites: number };
  /** The project's contentVersion this document was built from. */
  sourceVersion: number;
  projectionVersion: number;
}

export const PUBLIC_SEARCH_DOC_KEYS = [
  "entityType", "entityId", "route", "title", "description", "category", "tags", "categoryData", "owner",
  "favoriteCount", "createdAt", "updatedAt", "searchText", "ranking", "sourceVersion", "projectionVersion",
] as const;

/** The fields a search hit may carry to a client: the document minus searchText and ranking. */
export const SEARCH_HIT_KEYS = PUBLIC_SEARCH_DOC_KEYS.filter((k) => k !== "searchText" && k !== "ranking");

export function isSearchEligible(p: Pick<SearchSourceProject, "listed" | "status" | "visibility">): boolean {
  return p.listed && p.status === "active" && p.visibility === "public";
}

function buildSearchText(parts: (string | null | undefined)[]): string {
  return parts
    .filter((s): s is string => !!s && s.trim() !== "")
    .map((s) => s.normalize("NFKC").replace(/\s+/g, " ").trim())
    .join(" \n ")
    .slice(0, MAX_SEARCH_TEXT);
}

/** The search document for a project, or null when it must not be searchable. */
export function toPublicSearchDoc(
  project: SearchSourceProject,
  owner: SearchSourceOwner | null,
  tags: readonly SearchSourceTag[],
): PublicSearchDoc | null {
  if (!isSearchEligible(project)) return null;
  const activeTags = tags.filter((t) => t.status === "active").map((t) => ({ id: t.id, name: t.name }));
  const description = project.description?.trim() ? project.description : null;
  const publicOwner = owner ? { username: owner.username, fullName: owner.fullName?.trim() ? owner.fullName : null } : null;
  return {
    entityType: "project",
    entityId: project.id,
    route: `/projects/${encodeURIComponent(project.slug)}`,
    title: project.title,
    description,
    category: project.category,
    tags: activeTags,
    categoryData: publicCategoryData(project.categoryData, project.fieldOrder),
    owner: publicOwner,
    favoriteCount: project.favoriteCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    searchText: buildSearchText([
      project.title,
      description,
      ...activeTags.map((t) => t.name),
      project.category,
      publicOwner?.username,
      publicOwner?.fullName,
    ]),
    ranking: { favorites: project.rankingFavoriteCount },
    sourceVersion: project.contentVersion,
    projectionVersion: SEARCH_PROJECTION_VERSION,
  };
}

const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;
const PROVIDER_SUBJECT = /\buser_[A-Za-z0-9_]+/;

/**
 * Throws unless value has exactly the PublicSearchDoc keys and no email- or
 * provider-subject-shaped ID or owner field. Same idea as assertPublicProject:
 * the adapter runs it before a document leaves for any index.
 */
export function assertPublicSearchDoc(value: unknown): asserts value is PublicSearchDoc {
  if (!value || typeof value !== "object") throw new Error("search doc: not an object");
  const d = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(d)) if (!(PUBLIC_SEARCH_DOC_KEYS as readonly string[]).includes(key)) problems.push(`${key} is not public`);
  for (const key of PUBLIC_SEARCH_DOC_KEYS) if (!Object.hasOwn(d, key)) problems.push(`${key} is missing`);
  if (d.entityType !== "project") problems.push("entityType must be project");
  if (typeof d.searchText !== "string" || d.searchText.length > MAX_SEARCH_TEXT) problems.push("searchText too long");
  if (d.ranking && typeof d.ranking === "object") {
    for (const key of Object.keys(d.ranking)) if (key !== "favorites") problems.push(`ranking.${key} is not allowed`);
  }
  if (Array.isArray(d.tags)) {
    for (const t of d.tags as Record<string, unknown>[]) {
      for (const key of Object.keys(t)) if (key !== "id" && key !== "name") problems.push(`tags[].${key} is not public`);
    }
  } else problems.push("tags must be an array");
  if (d.owner !== null) {
    if (!d.owner || typeof d.owner !== "object") problems.push("owner must be an object or null");
    else for (const [k, v] of Object.entries(d.owner)) {
      if (k !== "username" && k !== "fullName") problems.push(`owner.${k} is not public`);
      if (typeof v === "string" && (EMAIL.test(v) || PROVIDER_SUBJECT.test(v))) problems.push(`owner.${k} looks like an email or provider subject`);
    }
  }
  if (typeof d.entityId === "string" && (EMAIL.test(d.entityId) || PROVIDER_SUBJECT.test(d.entityId))) problems.push("entityId looks like an email or provider subject");
  if (problems.length) throw new Error(`search doc contract violated:\n- ${problems.join("\n- ")}`);
}
