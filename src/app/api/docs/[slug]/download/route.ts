/**
 * Download All Docs as ZIP API Route
 * 
 * GET /api/docs/[slug]/download
 * 
 * Downloads all documentation files as a ZIP archive.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { routeDocOwner } from '@/lib/auth-server';
import { unauthorized } from '@/lib/api-errors';
import { ownerMeta, readableDoc } from '@/lib/docs-access';
import { docDir } from '@/lib/docs-output-root';

interface RouteParams {
  params: Promise<{
    slug: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // D11s: identity from the session only; signed out is refused before anything is read
    const owner = await routeDocOwner();
    if (!owner) {
      return unauthorized('Authentication required to download documentation');
    }

    const { slug } = await params;
    
    // Owner only, even for a linked doc: the ZIP is the whole doc in one request.
    // Anyone else gets the same 404 as a missing doc.
    const doc = await readableDoc(slug, owner);
    if (!doc?.isOwner) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    const projectDir = docDir(slug);
    const projectName = doc.meta.repoName || slug;
    
    // Create ZIP archive
    const zip = new JSZip();
    
    // Read all files in the project directory
    const files = await fs.readdir(projectDir);
    
    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.json')) {
        const filePath = path.join(projectDir, file);
        // The metadata goes in without its server-only fields (no Clerk-era subject)
        const content = file === '_meta.json'
          ? JSON.stringify(ownerMeta(doc.meta), null, 2)
          : await fs.readFile(filePath, 'utf-8');
        zip.file(file, content);
      }
    }
    
    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    
    // Return ZIP file - convert Buffer to Uint8Array for type compatibility
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${projectName}-docs.zip"`,
      },
    });
  } catch (error) {
    console.error('[docs-download] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create download' },
      { status: 500 }
    );
  }
}
