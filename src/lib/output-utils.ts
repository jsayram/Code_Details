/**
 * Generated docs: the app's side of the engine's DocStore (X2).
 *
 * The engine owns the doc's facts (repo, chapters, generation time, model) and
 * how they are stored (`repo-docs/store`). Code Details adds who owns the
 * doc and which project it is linked to; those fields live in the same
 * metadata record but only the app reads them. Ownership checks stay in the
 * app (src/lib/docs-access.ts and the /api/docs routes) and wrap the store.
 */

import { FileDocStore } from 'repo-docs/store/file';
import type { DocChapterInfo, DocMeta } from 'repo-docs/store';
import { docsOutputRoot } from './docs-output-root';

export { generateDocSlug as generateProjectSlug } from 'repo-docs/store';

export type ChapterInfo = DocChapterInfo;

export interface ProjectMeta extends DocMeta {
  /** The owner's key (the account's Convex ID; Clerk-era docs: a Clerk subject). */
  userId: string;
  // Generator re-key: the owner's Clerk-era subject on docs re-keyed before
  // E03. No longer written or used as a key; server-only, never in a response.
  legacyUserId?: string;
  // Linked CodeDetails project fields
  linkedProjectId?: string;
  linkedProjectSlug?: string;
  linkedProjectTitle?: string;
}

/** Generated docs on this server's disk: src/app/output/<slug>/ (tests: .test-runtime/docs-output). */
export const docStore = new FileDocStore<ProjectMeta>(docsOutputRoot());

/**
 * Find a doc linked to a specific project
 */
export async function findDocLinkedToProject(
  projectSlug: string
): Promise<ProjectMeta | null> {
  try {
    const allProjects = await docStore.listDocs();
    return allProjects.find(p => p.linkedProjectSlug === projectSlug) || null;
  } catch {
    return null;
  }
}
