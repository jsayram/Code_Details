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
import { executeQuery } from '@/db/server';
import { projects } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

const getOwnBySlug = makeFunctionReference<"query", { slug: string }, { id: string; slug: string; status: string } | null>("projects:getOwnBySlug");

/** Convex: the page's public projection, else the caller's own active project. No owner ID either way. */
async function convexProject(slug: string): Promise<{ id: string; user_id?: string | null } | null> {
  const listed = await getProjectReadBackend().getPublicProjectBySlug(slug);
  if (listed) return { id: listed.id };
  const own = (await viewerQueryWithArgs(getOwnBySlug, { slug }))?.result ?? null;
  return own && own.status === 'active' ? { id: own.id } : null;
}

async function supabaseProject(slug: string): Promise<{ id: string; user_id?: string | null } | null> {
  return executeQuery(async (db) => {
    const result = await db
      .select({ id: projects.id, slug: projects.slug, user_id: projects.user_id })
      .from(projects)
      .where(
        and(
          eq(projects.slug, slug),
          isNull(projects.deleted_at)
        )
      )
      .limit(1);
    return result.length > 0 ? result[0] : null;
  });
}

interface RouteParams {
  params: Promise<{
    slug: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;

    // The project as its page would find it. Under both development switches
    // projects live in Convex: the public projection, or the caller's own
    // project (private included) from the session. Otherwise Supabase.
    const project = personalReadsFromConvex() ? await convexProject(slug) : await supabaseProject(slug);

    if (!project) {
      return notFound('project', { identifier: slug });
    }

    // Find documentation linked to this project. Generator re-key: the link
    // must point at this exact project (a stale link to an older project with
    // the same slug doesn't count), and on Supabase the project must be the
    // doc owner's, as the doc reads require (src/lib/docs-access.ts).
    const found = await findDocLinkedToProject(slug);
    const linkedDoc =
      found &&
      found.linkedProjectId === project.id &&
      (project.user_id === undefined || (!!project.user_id && (project.user_id === found.userId || project.user_id === found.legacyUserId)))
        ? found
        : null;

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
