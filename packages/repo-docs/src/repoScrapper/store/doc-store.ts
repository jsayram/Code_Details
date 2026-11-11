// X2: where a generated doc is kept. The engine describes a doc (its chapters
// and the facts of the run that made it) and saves it through a DocStore that
// the caller provides. A caller may keep its own fields in the same metadata
// record (TMeta extends DocMeta); the store saves and returns them untouched
// but never reads them.
//
// Nothing here touches the disk, so this module is safe to import anywhere.
// FileDocStore (./file-doc-store) is the on-disk implementation.

/** One chapter as listed in a doc's metadata. */
export interface DocChapterInfo {
  filename: string;
  title: string;
  order: number;
  abstractionsCovered: string[];
}

/** The engine's facts about a generated doc. */
export interface DocMeta {
  /** The doc's slug (its folder name in FileDocStore). */
  projectSlug: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  branch?: string;
  /** When the doc was generated (ISO 8601). */
  createdAt: string;
  chapters: DocChapterInfo[];
  llmProvider: string;
  llmModel: string;
  totalTokensUsed?: number;
  totalCost?: number;
}

/** A chapter to save. Its filename comes from `order` and `title`. */
export interface NewChapter {
  order: number;
  title: string;
  content: string;
  abstractionsCovered: string[];
}

/** A stored file of a doc, as handed out for an archive. */
export interface DocFile {
  name: string;
  content: string;
}

export interface DocStore<TMeta extends DocMeta = DocMeta> {
  /** Saves a chapter with its frontmatter; returns the chapter's filename. */
  saveChapter(slug: string, chapter: NewChapter): Promise<string>;
  /** Writes the doc's whole metadata record. */
  saveMeta(slug: string, meta: Omit<TMeta, "projectSlug">): Promise<void>;
  /** The metadata, or null when the doc is missing, unreadable or the slug is unsafe. */
  readMeta(slug: string): Promise<TMeta | null>;
  /** Merges `updates` into the metadata (the slug never changes); null when there is no doc. */
  updateMeta(slug: string, updates: Partial<TMeta>): Promise<TMeta | null>;
  /** Every doc's metadata, newest first. */
  listDocs(): Promise<TMeta[]>;
  /** A chapter's stored text (frontmatter included), or null when the name is unsafe or there is no such file. */
  readChapter(slug: string, filename: string): Promise<string | null>;
  /** Replaces an existing chapter's stored text; false when there is no such chapter. */
  writeChapter(slug: string, filename: string, raw: string): Promise<boolean>;
  /** The doc's Markdown and JSON files, for an archive. */
  exportFiles(slug: string): Promise<DocFile[]>;
  /** Removes the doc; false when it could not (an unsafe slug included). */
  deleteDoc(slug: string): Promise<boolean>;
}

// ============================================================================
// Names (D11s). A slug or chapter filename that doesn't match is refused
// outright, never stripped into some other name, so "..", slashes, dots and
// encoded separators can't leave the store's root or land on a different doc.
// ============================================================================

const DOC_SLUG = /^[a-z0-9_-]{1,255}$/i;
const CHAPTER_FILENAME = /^[a-z0-9_-][a-z0-9_.-]{0,250}\.md$/i;

export function isSafeDocSlug(slug: unknown): slug is string {
  return typeof slug === "string" && DOC_SLUG.test(slug);
}

export function isSafeChapterFilename(filename: unknown): filename is string {
  return typeof filename === "string" && CHAPTER_FILENAME.test(filename) && !filename.includes("..");
}

/**
 * A new doc slug from owner/repo.
 * Format: owner-repo-YYYYMMDD-random
 */
export function generateDocSlug(owner: string, repo: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  const safeName = `${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  return `${safeName}-${date}-${random}`;
}

/**
 * A chapter's filename from its order and title. The generated index links to
 * chapters by these names, so the flow and the stores must both use this.
 * Format: 00_title-slug.md (the overview is order -1: "-1_overview.md")
 */
export function createChapterFilename(order: number, title: string): string {
  const paddedOrder = String(order).padStart(2, "0");
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  return `${paddedOrder}_${safeTitle}.md`;
}

// ============================================================================
// Chapter frontmatter
// ============================================================================

export interface ChapterFrontmatter {
  title: string;
  order: number;
  generatedAt: string;
  abstractionsCovered: string[];
}

export function createFrontmatter(frontmatter: ChapterFrontmatter): string {
  return [
    "---",
    `title: "${frontmatter.title.replace(/"/g, '\\"')}"`,
    `order: ${frontmatter.order}`,
    `generatedAt: "${frontmatter.generatedAt}"`,
    `abstractionsCovered:`,
    ...frontmatter.abstractionsCovered.map((a) => `  - "${a.replace(/"/g, '\\"')}"`),
    "---",
    "",
  ].join("\n");
}
