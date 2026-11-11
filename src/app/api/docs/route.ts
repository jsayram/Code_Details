/**
 * List Generated Docs API Route
 * 
 * GET /api/docs
 * 
 * Returns a list of all generated documentation projects for the current user.
 * RFC 7807 compliant error responses.
 */

import { NextRequest } from 'next/server';
import { routeDocOwner } from '@/lib/auth-server';
import { isDocOwner } from '@/lib/docs-access';
import { docStore } from '@/lib/output-utils';
import { unauthorized, serverError, success } from '@/lib/api-errors';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const owner = await routeDocOwner();
    
    if (!owner) {
      return unauthorized('Authentication required to view your generated documentation');
    }

    // Get all projects
    const allProjects = await docStore.listDocs();
    console.log('[docs-list] All projects found:', allProjects.length);
    
    // Filter to only show user's projects
    const userProjects = allProjects.filter((p) => isDocOwner(p, owner));
    console.log('[docs-list] User projects after filter:', userProjects.length);
    
    // Format response with linked project info
    const projects = userProjects.map((p) => ({
      slug: p.projectSlug,
      projectName: p.repoName,
      repoUrl: p.repoUrl,
      createdAt: p.createdAt,
      chapterCount: p.chapters.length,
      linkedProjectId: p.linkedProjectId || null,
      linkedProjectSlug: p.linkedProjectSlug || null,
      linkedProjectTitle: p.linkedProjectTitle || null,
    }));
    
    // Sort by creation date (newest first)
    projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return success(
      { projects },
      { total: projects.length }
    );
  } catch (error) {
    console.error('[docs-list] Error:', error);
    return serverError(error, 'Failed to list generated documentation');
  }
}
