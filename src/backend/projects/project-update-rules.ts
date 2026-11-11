// Project update rules (D02, P08 R27–R29), shared by the Convex mutation
// (convex/projects.ts update) and the Supabase server action, so the two
// backends refuse the same input. Pure functions with relative imports only:
// the Convex bundle loads this file too.
//
// - Tags are deduplicated by nameKey before anything is written (R27).
// - Links, and category fields of type "url", accept only http: and https:
//   (R29; anything else, javascript: included, would end up in an <a href>).
// - categoryData has a total size cap (R29). The per-category field schema is
//   strict on Convex; the Supabase path skips unknown keys because real rows
//   still carry some (D00b dropped them for Convex only).
import { PROJECT_CATEGORIES, type ProjectCategory } from "../../constants/project-categories";
import { getCategoryFields } from "../../constants/project-category-fields";
import { PROFANITY_LIST } from "../../constants/profanity-list";
import { PROJECT_LINK_LIMITS, PROJECT_TEXT_LIMITS, TAG_LIMITS, VALIDATION_LIMITS } from "../../constants/project-limits";

/** Bumped when the category field definitions change in a way stored data must follow. */
export const CATEGORY_FIELDS_VERSION = 1;
/** Total JSON size of categoryData, in UTF-16 code units (close enough to bytes for a cap). */
export const MAX_CATEGORY_DATA_CHARS = 16 * 1024;
/** Values in one multi-select field. */
export const MAX_CATEGORY_LIST_ITEMS = 50;
/** A single text value with no maxLength of its own. */
export const MAX_CATEGORY_TEXT_LENGTH = 2000;

export const LINK_TYPE_VALUES = ["repository", "demo", "documentation", "video", "figma", "notion", "slides", "article", "custom"] as const;
const LINK_TYPE_SET = new Set<string>(LINK_TYPE_VALUES);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Issue {
  field: string;
  message: string;
}

export type CategoryValue = string | number | boolean | string[];
export type CategoryData = Record<string, CategoryValue>;

export interface ProjectLinkInput {
  url: string;
  label?: string;
  type?: string;
}

export function containsProfanity(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const normalized = text.toLowerCase().trim();
  return PROFANITY_LIST.some((word) => {
    const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return wordRegex.test(normalized);
  });
}

/** P07 §5.13: trim → NFKC → lowercase → collapse internal whitespace. Punctuation stays. */
export const tagNameKey = (s: string) => s.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

/** P07 §9: the alphabetical sort key. */
export const titleSortKey = (s: string) => s.normalize("NFKC").toLowerCase();

export function isKnownCategory(category: string): category is ProjectCategory {
  return Object.hasOwn(PROJECT_CATEGORIES, category);
}

/** True only for an absolute http: or https: URL. */
export function isHttpUrl(value: string): boolean {
  if (typeof value !== "string" || value.length > VALIDATION_LIMITS.MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Trimmed tags, deduplicated by nameKey (the first spelling wins), in input
 * order. Length, profanity and the 15-tag limit are checked after the dedupe,
 * so `React` + `react` is one tag, not an error.
 */
export function dedupeTags(names: string[]): { tags: { name: string; nameKey: string }[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const tags: { name: string; nameKey: string }[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length < TAG_LIMITS.MIN_TAG_LENGTH || name.length > TAG_LIMITS.MAX_TAG_LENGTH) {
      issues.push({ field: "tags", message: `Tags must be ${TAG_LIMITS.MIN_TAG_LENGTH}-${TAG_LIMITS.MAX_TAG_LENGTH} characters` });
      continue;
    }
    if (containsProfanity(name)) {
      issues.push({ field: "tags", message: "Tag contains inappropriate content" });
      continue;
    }
    const nameKey = tagNameKey(name);
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);
    tags.push({ name, nameKey });
  }
  if (tags.length > TAG_LIMITS.MAX_TAGS_PER_PROJECT) {
    issues.push({ field: "tags", message: `Maximum ${TAG_LIMITS.MAX_TAGS_PER_PROJECT} tags allowed` });
  }
  return { tags, issues };
}

export function checkLinks(links: ProjectLinkInput[]): Issue[] {
  const issues: Issue[] = [];
  if (links.length > PROJECT_LINK_LIMITS.MAX_URL_LINKS) {
    issues.push({ field: "url_links", message: `Maximum ${PROJECT_LINK_LIMITS.MAX_URL_LINKS} links allowed` });
  }
  for (const link of links) {
    if (!isHttpUrl(link.url)) issues.push({ field: "url_links", message: "Links must be http or https URLs" });
    if (link.type !== undefined && !LINK_TYPE_SET.has(link.type)) issues.push({ field: "url_links", message: "Unknown link type" });
    if (link.label !== undefined && link.label.length > PROJECT_TEXT_LIMITS.MAX_LINK_LABEL_LENGTH) {
      issues.push({ field: "url_links", message: `Label must be at most ${PROJECT_TEXT_LIMITS.MAX_LINK_LABEL_LENGTH} characters` });
    }
  }
  return issues;
}

export function categoryDataTooLarge(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  return JSON.stringify(data).length > MAX_CATEGORY_DATA_CHARS;
}

/**
 * categoryData against the category's field definitions. With strictKeys, a
 * key the category doesn't define is an issue; without it, unknown keys are
 * left alone (the Supabase path, see the header) but every known field is
 * still typed and url fields are still http(s) only.
 */
export function checkCategoryData(
  category: string,
  data: Record<string, unknown> | null | undefined,
  fieldOrder: string[] | null | undefined,
  { strictKeys }: { strictKeys: boolean },
): Issue[] {
  const issues: Issue[] = [];
  const field = "category_data";
  const fields = new Map(getCategoryFields((isKnownCategory(category) ? category : "other") as ProjectCategory).map((f) => [f.id, f]));
  if (data !== null && data !== undefined) {
    if (typeof data !== "object" || Array.isArray(data)) return [{ field, message: "Project details must be an object" }];
    if (categoryDataTooLarge(data)) issues.push({ field, message: "Project details are too large" });
    for (const [key, value] of Object.entries(data)) {
      const def = fields.get(key);
      if (!def) {
        if (strictKeys) issues.push({ field, message: `Unknown field for this category: ${key}` });
        continue;
      }
      const limit = def.maxLength ?? MAX_CATEGORY_TEXT_LENGTH;
      const text = (s: unknown) => typeof s === "string" && s.length <= limit && !containsProfanity(s);
      let ok: boolean;
      if (def.type === "multi-select") {
        ok = Array.isArray(value) && value.length <= MAX_CATEGORY_LIST_ITEMS && value.every(text);
      } else if (def.type === "number") {
        ok = typeof value === "number" && Number.isFinite(value);
      } else if (def.type === "url") {
        ok = typeof value === "string" && (value === "" || isHttpUrl(value));
      } else {
        ok = text(value);
      }
      if (!ok) issues.push({ field, message: `Invalid value for ${def.label}` });
    }
  }
  if (fieldOrder !== null && fieldOrder !== undefined) {
    const unique = new Set(fieldOrder);
    if (unique.size !== fieldOrder.length) issues.push({ field: "field_order", message: "Duplicate field in field order" });
    if (strictKeys && fieldOrder.some((k) => !fields.has(k))) issues.push({ field: "field_order", message: "Unknown field in field order" });
    if (fieldOrder.length > fields.size + (strictKeys ? 0 : MAX_CATEGORY_LIST_ITEMS)) issues.push({ field: "field_order", message: "Field order is too long" });
  }
  return issues;
}

/** The fields an update may change. Everything else is refused (R27–R29, forbidden fields). */
export interface ProjectPatch {
  title?: string;
  slug?: string;
  description?: string | null;
  category?: string;
  links?: ProjectLinkInput[];
  tags?: string[];
  categoryData?: CategoryData | null;
  fieldOrder?: string[] | null;
}

export interface NormalizedPatch {
  title?: string;
  slug?: string;
  /** null clears it. */
  description?: string | null;
  category?: string;
  links?: ProjectLinkInput[];
  tags?: { name: string; nameKey: string }[];
  categoryData?: CategoryData | null;
  fieldOrder?: string[] | null;
}

/**
 * The full check for the Convex mutation. `currentCategory` is the stored
 * category, used when the patch doesn't change it, so categoryData is always
 * checked against the category it will be saved under.
 */
export function normalizeProjectPatch(patch: ProjectPatch, currentCategory: string): { value: NormalizedPatch; issues: Issue[] } {
  const issues: Issue[] = [];
  const value: NormalizedPatch = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length < PROJECT_TEXT_LIMITS.MIN_TITLE_LENGTH || title.length > PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH) {
      issues.push({ field: "title", message: `Title must be ${PROJECT_TEXT_LIMITS.MIN_TITLE_LENGTH}-${PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH} characters` });
    } else if (containsProfanity(title)) {
      issues.push({ field: "title", message: "Title contains inappropriate content" });
    }
    value.title = title;
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim();
    if (!SLUG_RE.test(slug) || slug.length > PROJECT_TEXT_LIMITS.MAX_SLUG_LENGTH) {
      issues.push({ field: "slug", message: "Slug must be lowercase alphanumeric with hyphens" });
    } else if (containsProfanity(slug.replace(/-/g, " "))) {
      issues.push({ field: "slug", message: "Slug contains inappropriate content" });
    }
    value.slug = slug;
  }
  if (patch.description !== undefined) {
    const description = patch.description?.trim() ?? "";
    if (description.length > PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH) {
      issues.push({ field: "description", message: `Description must be at most ${PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH} characters` });
    } else if (containsProfanity(description)) {
      issues.push({ field: "description", message: "Description contains inappropriate content" });
    }
    value.description = description === "" ? null : description;
  }
  if (patch.category !== undefined) {
    if (!isKnownCategory(patch.category)) issues.push({ field: "category", message: "Unknown category" });
    value.category = patch.category;
  }
  if (patch.links !== undefined) {
    issues.push(...checkLinks(patch.links));
    value.links = patch.links.map((l) => ({ url: l.url, label: l.label === "" ? undefined : l.label, type: l.type }));
  }
  if (patch.tags !== undefined) {
    const { tags, issues: tagIssues } = dedupeTags(patch.tags);
    issues.push(...tagIssues);
    value.tags = tags;
  }
  const category = value.category ?? currentCategory;
  if (patch.categoryData !== undefined || patch.fieldOrder !== undefined) {
    issues.push(...checkCategoryData(category, patch.categoryData, patch.fieldOrder, { strictKeys: true }));
  }
  if (patch.categoryData !== undefined) {
    value.categoryData = patch.categoryData && Object.keys(patch.categoryData).length ? patch.categoryData : null;
  }
  if (patch.fieldOrder !== undefined) {
    value.fieldOrder = patch.fieldOrder && patch.fieldOrder.length ? patch.fieldOrder : null;
  }
  return { value, issues };
}
