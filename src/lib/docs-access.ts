// D11s: who may read a generated doc (option B, chosen by the master thread
// for Jose). The owner always may. Another signed-in user may read the
// chapters and a trimmed metadata view only while the doc is linked to a
// project that this viewer can open on the project page today (its public
// projection). The ZIP download is owner-only. Every refusal
// reads as a missing doc. `owner` must come from routeDocOwner(), never a request.
//
// Generator re-key: a doc is the caller's when its `userId` (the account's
// Convex ID) is one of the caller's own keys. E03: a Clerk-era `legacyUserId`
// left in an older doc's metadata is never a key any more; it is still
// stripped from the owner's responses (ownerMeta).
import { getProjectReadBackend } from '@/backend/projects';
import { personalReadsFromConvex } from '@/backend/projects/personal';
import { getProjectMeta, type ProjectMeta } from '@/lib/output-utils';
import { isSafeDocSlug } from '@/lib/docs-output-root';
import type { DocOwner } from '@/lib/auth-server';

export type ReadableDoc = { meta: ProjectMeta; isOwner: boolean };

export function isDocOwner(meta: Pick<ProjectMeta, 'userId'> | null | undefined, owner: DocOwner | null): boolean {
  if (!meta || !owner) return false;
  return typeof meta.userId === 'string' && meta.userId.length > 0 && owner.keys.includes(meta.userId);
}

export async function readableDoc(slug: string, owner: DocOwner | null): Promise<ReadableDoc | null> {
  if (!owner || !isSafeDocSlug(slug)) return null;
  const meta = await getProjectMeta(slug);
  if (!meta || typeof meta.userId !== 'string' || !meta.userId) return null;
  if (isDocOwner(meta, owner)) return { meta, isOwner: true };
  if (!meta.linkedProjectId || !meta.linkedProjectSlug) return null;
  try {
    return (await linkedProjectOpen(meta)) ? { meta, isOwner: false } : null;
  } catch {
    return null;
  }
}

/**
 * Whether a non-owner may read a linked doc: the linked project is still that
 * exact project and this viewer can open its page today.
 *
 * Convex reads (the same rule as the personal lists, so link IDs are Convex
 * IDs; E03: no Supabase fallback): the page's public projection by slug,
 * with the same ID. The projection carries no owner ID, and no function takes
 * one, so ownership is checked when the link is made (PATCH, against the
 * caller's own projects) instead; projects never change owner and only the
 * server writes the metadata. Private projects aren't readable by anyone but
 * their owner, so their docs aren't either.
 */
async function linkedProjectOpen(meta: ProjectMeta): Promise<boolean> {
  const projectSlug = meta.linkedProjectSlug!;
  if (!personalReadsFromConvex()) return false;
  const project = await getProjectReadBackend().getPublicProjectBySlug(projectSlug);
  return !!project && project.id === meta.linkedProjectId && project.slug === projectSlug;
}

/** The metadata without server-only fields, for the owner's own responses. */
export function ownerMeta(meta: ProjectMeta): Omit<ProjectMeta, 'legacyUserId'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { legacyUserId, ...rest } = meta;
  return rest;
}

/**
 * What the docs viewer page needs from the metadata. The owner gets all of it;
 * anyone else gets no owner ID (null, so the page's `meta.userId === user.id`
 * check stays false even with no client user), cost, tokens or link fields.
 */
export function metaForViewer({ meta, isOwner }: ReadableDoc) {
  if (isOwner) return { ...ownerMeta(meta), isOwner };
  return {
    projectSlug: meta.projectSlug,
    userId: null,
    isOwner,
    repoUrl: meta.repoUrl,
    createdAt: meta.createdAt,
    // Older docs list chapters as plain filenames; the page handles both.
    chapters: (meta.chapters ?? []).map((c) => (typeof c === 'string' ? c : { filename: c.filename, title: c.title, order: c.order })),
    llmProvider: meta.llmProvider,
    llmModel: meta.llmModel,
  };
}
