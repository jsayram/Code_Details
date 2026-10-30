// D11s: who may read a generated doc (option B, chosen by the master thread
// for Jose). The owner always may. Another signed-in user may read the
// chapters and a trimmed metadata view only while the doc is linked to a
// project of the owner's that this viewer can open on the project page today:
// the same readProjectBySlug rule the page uses (soft-deleted projects only for
// their owner and the admin). The ZIP download is owner-only. Every refusal
// reads as a missing doc. `owner` must come from routeDocOwner(), never a request.
//
// Generator re-key: a doc is the caller's when its `userId` (the account's
// Convex ID on new docs, a Clerk subject on older ones) or its `legacyUserId`
// is one of the caller's own keys.
import { readProjectBySlug } from '@/db/project-read';
import { getProjectReadBackend } from '@/backend/projects';
import { personalReadsFromConvex } from '@/backend/projects/personal';
import { getProjectMeta, type ProjectMeta } from '@/lib/output-utils';
import { isSafeDocSlug } from '@/lib/docs-output-root';
import type { DocOwner } from '@/lib/auth-server';

export type ReadableDoc = { meta: ProjectMeta; isOwner: boolean };

export function isDocOwner(meta: Pick<ProjectMeta, 'userId' | 'legacyUserId'> | null | undefined, owner: DocOwner | null): boolean {
  if (!meta || !owner) return false;
  const docKeys = [meta.userId, meta.legacyUserId].filter((k): k is string => typeof k === 'string' && k.length > 0);
  return docKeys.some((k) => owner.keys.includes(k));
}

export async function readableDoc(slug: string, owner: DocOwner | null): Promise<ReadableDoc | null> {
  if (!owner || !isSafeDocSlug(slug)) return null;
  const meta = await getProjectMeta(slug);
  if (!meta || typeof meta.userId !== 'string' || !meta.userId) return null;
  if (isDocOwner(meta, owner)) return { meta, isOwner: true };
  if (!meta.linkedProjectId || !meta.linkedProjectSlug) return null;
  try {
    return (await linkedProjectOpen(meta, owner)) ? { meta, isOwner: false } : null;
  } catch {
    return null;
  }
}

/**
 * Whether a non-owner may read a linked doc: the linked project is still that
 * exact project and this viewer can open its page today.
 *
 * Supabase reads: the page's readProjectBySlug with the viewer's own session,
 * and the project must be the doc owner's (either of the doc's keys).
 *
 * Convex reads (both development switches, the same rule as the personal
 * lists, so link IDs are Convex IDs): the page's public projection by slug,
 * with the same ID. The projection carries no owner ID, and no function takes
 * one, so ownership is checked when the link is made (PATCH, against the
 * caller's own projects) instead; projects never change owner and only the
 * server writes the metadata. Private projects aren't readable by anyone but
 * their owner, so their docs aren't either.
 */
async function linkedProjectOpen(meta: ProjectMeta, owner: DocOwner): Promise<boolean> {
  const projectSlug = meta.linkedProjectSlug!;
  if (personalReadsFromConvex()) {
    const project = await getProjectReadBackend().getPublicProjectBySlug(projectSlug);
    return !!project && project.id === meta.linkedProjectId && project.slug === projectSlug;
  }
  const project = await readProjectBySlug(projectSlug, owner.projectViewer);
  // The link must still point at that exact project, and it must be the doc owner's
  // (Supabase projects are keyed by the Clerk-era subject, so either doc key counts).
  if (!project || project.id !== meta.linkedProjectId) return false;
  return project.user_id === meta.userId || project.user_id === meta.legacyUserId;
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
