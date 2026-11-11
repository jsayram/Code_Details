/**
 * Get Linked Documentation for a Project API Route
 * 
 * GET /api/projects/slug/[slug]/linked-doc
 * 
 * Returns the generated documentation linked to a specific project.
 * Accessible to anyone (for viewing on project page).
 * RFC 7807 compliant error responses.
 */

import { NextRequest } from 'next/server';
import { makeFunctionReference } from 'convex/server';
import { findDocLinkedToProject } from '@/lib/output-utils';
import { getProjectReadBackend } from '@/backend/projects';
import { personalReadsFromConvex } from '@/backend/projects/personal';
import { viewerQueryWithArgs } from '@/lib/auth-server';
import { notFound, serverError, success } from '@/lib/api-errors';

const getOwnBySlug = makeFunctionReference<"query", { slug: string }, { id: string; slug: string; status: string } | null>("projects:getOwnBySlug");

/** Convex: the page's public projection, else the caller's own active project. No owner ID either way. */
async function convexProject(slug: string): Promise<{ id: string } | null> {
  const listed = await getProjectReadBackend().getPublicProjectBySlug(slug);
  if (listed) return { id: listed.id };
  const own = (await viewerQueryWithArgs(getOwnBySlug, { slug }))?.result ?? null;
  return own && own.status === 'active' ? { id: own.id } : null;
}

interface RouteParams {
  params: Promise<{
    slug: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;

    // The project as its page would find it, from Convex: the public
    // projection, or the caller's own project (private included) from the
    // session. E03: with no local Convex (no Supabase fallback) there is none.
    const project = personalReadsFromConvex() ? await convexProject(slug) : null;

    if (!project) {
      return notFound('project', { identifier: slug });
    }

    // Find documentation linked to this project. Generator re-key: the link
    // must point at this exact project (a stale link to an older project with
    // the same slug doesn't count). Ownership was checked when the link was
    // made (src/lib/docs-access.ts).
    const found = await findDocLinkedToProject(slug);
    const linkedDoc = found && found.linkedProjectId === project.id ? found : null;

    if (!linkedDoc) {
      // Return success with null - no doc linked
      return success({
        hasLinkedDoc: false,
        linkedDoc: null,
      });
    }

    // Return the linked doc info
    return success({
      hasLinkedDoc: true,
      linkedDoc: {
        docSlug: linkedDoc.projectSlug,
        projectName: linkedDoc.repoName,
        repoUrl: linkedDoc.repoUrl,
        repoOwner: linkedDoc.repoOwner,
        repoName: linkedDoc.repoName,
        branch: linkedDoc.branch,
        createdAt: linkedDoc.createdAt,
        chapterCount: linkedDoc.chapters.length,
        chapters: linkedDoc.chapters.map(c => ({
          filename: c.filename,
          title: c.title,
          order: c.order,
        })),
        llmProvider: linkedDoc.llmProvider,
        llmModel: linkedDoc.llmModel,
      },
    });
  } catch (error) {
    console.error('[project-linked-doc] GET Error:', error);
    return serverError(error, 'Failed to get linked documentation for project');
  }
}
