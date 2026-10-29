// D11s: who may read a generated doc (option B, chosen by the master thread
// for Jose). The owner always may. Another signed-in user may read the
// chapters and a trimmed metadata view only while the doc is linked to a
// project of the owner's that this viewer can open on the project page today:
// the same readProjectBySlug rule the page uses (soft-deleted projects only for
// their owner and the admin). The ZIP download is owner-only. Every refusal
// reads as a missing doc. `viewer` must come from routeViewer(), never a request.
import { readProjectBySlug, type ProjectViewer } from '@/db/project-read';
import { getProjectMeta, type ProjectMeta } from '@/lib/output-utils';
import { isSafeDocSlug } from '@/lib/docs-output-root';

export type ReadableDoc = { meta: ProjectMeta; isOwner: boolean };

export async function readableDoc(slug: string, viewer: ProjectViewer): Promise<ReadableDoc | null> {
  if (!viewer?.userId || !isSafeDocSlug(slug)) return null;
  const meta = await getProjectMeta(slug);
  if (!meta || typeof meta.userId !== 'string' || !meta.userId) return null;
  if (meta.userId === viewer.userId) return { meta, isOwner: true };
  if (!meta.linkedProjectId || !meta.linkedProjectSlug) return null;
  try {
    const project = await readProjectBySlug(meta.linkedProjectSlug, viewer);
    // The link must still point at that exact project, and it must be the doc owner's.
    if (!project || project.id !== meta.linkedProjectId || project.user_id !== meta.userId) return null;
    return { meta, isOwner: false };
  } catch {
    return null;
  }
}

/**
 * What the docs viewer page needs from the metadata. The owner gets all of it;
 * anyone else gets no owner ID (null, so the page's `meta.userId === user.id`
 * check stays false even with no client user), cost, tokens or link fields.
 */
export function metaForViewer({ meta, isOwner }: ReadableDoc) {
  if (isOwner) return { ...meta, isOwner };
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
