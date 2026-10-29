/**
 * Get Project Metadata API Route
 * 
 * GET /api/docs/[slug]/meta
 * 
 * Returns the metadata for a generated documentation project.
 */

import { NextRequest, NextResponse } from 'next/server';
import { routeViewer } from '@/lib/auth-server';
import { unauthorized } from '@/lib/api-errors';
import { metaForViewer, readableDoc } from '@/lib/docs-access';

interface RouteParams {
  params: Promise<{
    slug: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // D11s: identity from the session only; signed out is refused before anything is read
    const viewer = await routeViewer();
    if (!viewer) {
      return unauthorized('Authentication required to read documentation');
    }

    const { slug } = await params;
    
    // Someone else's unshared doc gets the same 404 as a missing one
    const doc = await readableDoc(slug, viewer);
    
    if (!doc) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    // Non-owners get only what the viewer page shows (no owner ID, cost or link fields)
    return NextResponse.json(metaForViewer(doc));
  } catch (error) {
    console.error('[docs-meta] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load project metadata' },
      { status: 500 }
    );
  }
}
