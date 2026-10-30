/**
 * Link/Unlink Documentation to Project API Route
 * 
 * PATCH /api/docs/[slug]/link-project - Link doc to a CodeDetails project
 * DELETE /api/docs/[slug]/link-project - Unlink doc from project
 * 
 * Only one doc can be linked per project at a time.
 * RFC 7807 compliant error responses.
 */

import { NextRequest } from 'next/server';
import { routeDocOwner } from '@/lib/auth-server';
import { isDocOwner } from '@/lib/docs-access';
import { convexPersonalList, personalReadsFromConvex } from '@/backend/projects/personal';
import { 
  getProjectMeta, 
  updateProjectMeta, 
  listProjects,
  findDocLinkedToProject 
} from '@/lib/output-utils';
import { 
  unauthorized, 
  notFound, 
  notOwner, 
  serverError, 
  validationError,
  conflict,
  success 
} from '@/lib/api-errors';
import { linkProjectSchema, formatZodErrors } from '@/lib/validations/docs';
import { executeQuery } from '@/db/server';
import { projects } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

interface RouteParams {
  params: Promise<{
    slug: string;
  }>;
}

async function supabaseOwnProject(ownerId: string | undefined, projectId: string, projectSlug: string) {
  if (!ownerId) return null;
  return executeQuery(async (db) => {
    const result = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.slug, projectSlug),
          eq(projects.user_id, ownerId),
          isNull(projects.deleted_at)
        )
      )
      .limit(1);
    return result.length > 0 ? result[0] : null;
  });
}

/**
 * PATCH - Link documentation to a project
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate user
    const owner = await routeDocOwner();
    if (!owner) {
      return unauthorized('Authentication required to link documentation');
    }

    const { slug } = await params;

    // Get the documentation metadata
    const docMeta = await getProjectMeta(slug);
    if (!docMeta) {
      return notFound('documentation', { identifier: slug });
    }

    // Verify doc ownership
    if (!isDocOwner(docMeta, owner)) {
      return notOwner('documentation');
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = linkProjectSchema.safeParse(body);
    
    if (!validation.success) {
      return validationError(
        formatZodErrors(validation.error),
        'Invalid link project request'
      );
    }

    const { projectId, projectSlug, replace } = validation.data;

    // Verify the target project exists and the caller owns it. Under both
    // development switches projects live in Convex, and the caller's own
    // active projects come from the session (the same list the picker shows);
    // this is where a link's ownership is checked, since the read side can't
    // see a Convex project's owner. Otherwise Supabase via Drizzle, whose
    // projects are keyed by the Clerk-era subject, so an account without one
    // owns none there.
    const targetProject = personalReadsFromConvex()
      ? (await convexPersonalList('mine')).find((p) => p.id === projectId && p.slug === projectSlug) ?? null
      : await supabaseOwnProject(owner.projectViewer?.userId, projectId, projectSlug);

    if (!targetProject) {
      return notFound('project', { 
        identifier: projectSlug,
        detail: 'The target project was not found or you do not own it'
      });
    }

    // Check if target project already has a doc linked
    const existingLinkedDoc = await findDocLinkedToProject(projectSlug);
    
    if (existingLinkedDoc && existingLinkedDoc.projectSlug !== slug) {
      if (!replace) {
        // Return info about the existing doc so UI can show replacement dialog
        return conflict('documentation', 'linkedProjectSlug', projectSlug);
      }
      
      // Unlink the existing doc first
      await updateProjectMeta(existingLinkedDoc.projectSlug, {
        linkedProjectId: undefined,
        linkedProjectSlug: undefined,
        linkedProjectTitle: undefined,
      });
    }

    // Link the documentation to the project
    const updatedMeta = await updateProjectMeta(slug, {
      linkedProjectId: projectId,
      linkedProjectSlug: projectSlug,
      // The project's own title, not the one the request sent
      linkedProjectTitle: targetProject.title,
    });

    if (!updatedMeta) {
      return serverError(undefined, 'Failed to link documentation to project');
    }

    return success({
      linked: true,
      docSlug: slug,
      projectId,
      projectSlug,
      projectTitle: targetProject.title,
      replacedDoc: existingLinkedDoc?.projectSlug !== slug ? existingLinkedDoc?.projectSlug : null,
    });
  } catch (error) {
    console.error('[docs-link-project] PATCH Error:', error);
    return serverError(error, 'Failed to link documentation to project');
  }
}

/**
 * DELETE - Unlink documentation from project
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate user
    const owner = await routeDocOwner();
    if (!owner) {
      return unauthorized('Authentication required to unlink documentation');
    }

    const { slug } = await params;

    // Get the documentation metadata
    const docMeta = await getProjectMeta(slug);
    if (!docMeta) {
      return notFound('documentation', { identifier: slug });
    }

    // Verify doc ownership
    if (!isDocOwner(docMeta, owner)) {
      return notOwner('documentation');
    }

    // Check if doc is actually linked
    if (!docMeta.linkedProjectId) {
      return success({
        unlinked: true,
        docSlug: slug,
        message: 'Documentation was not linked to any project',
      });
    }

    const previousProjectSlug = docMeta.linkedProjectSlug;

    // Unlink the documentation
    const updatedMeta = await updateProjectMeta(slug, {
      linkedProjectId: undefined,
      linkedProjectSlug: undefined,
      linkedProjectTitle: undefined,
    });

    if (!updatedMeta) {
      return serverError(undefined, 'Failed to unlink documentation from project');
    }

    return success({
      unlinked: true,
      docSlug: slug,
      previousProjectSlug,
    });
  } catch (error) {
    console.error('[docs-link-project] DELETE Error:', error);
    return serverError(error, 'Failed to unlink documentation from project');
  }
}
