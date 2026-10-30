/**
 * Get/Update Chapter Content API Route
 * 
 * GET /api/docs/[slug]/[filename] - Get chapter content
 * PUT /api/docs/[slug]/[filename] - Update chapter content (owner only)
 * 
 * Returns/updates the content of a specific chapter file.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { routeDocOwner } from '@/lib/auth-server';
import { getProjectMeta } from '@/lib/output-utils';
import { unauthorized, notFound, notOwner, serverError, success } from '@/lib/api-errors';
import { docsOutputRoot, isSafeChapterFilename, isSafeDocSlug } from '@/lib/docs-output-root';
import { isDocOwner, readableDoc } from '@/lib/docs-access';

interface RouteParams {
  params: Promise<{
    slug: string;
    filename: string;
  }>;
}

// Output directory (relative to project root)
const OUTPUT_DIR = docsOutputRoot();

const chapterNotFound = () => NextResponse.json({ error: 'Chapter not found' }, { status: 404 });

/** The chapter's file, falling back to index.md for the overview; null if neither exists. */
async function existingChapterPath(slug: string, filename: string): Promise<string | null> {
  const candidates = [path.join(OUTPUT_DIR, slug, filename)];
  if (filename === '-1_overview.md') candidates.push(path.join(OUTPUT_DIR, slug, 'index.md'));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // D11s: identity from the session only; signed out is refused before anything is read
    const owner = await routeDocOwner();
    if (!owner) {
      return unauthorized('Authentication required to read documentation');
    }

    const { slug, filename } = await params;

    // A bad name, a doc this user can't read and a missing chapter all get the
    // same 404, so the answer never says whether someone else's doc exists.
    if (!isSafeDocSlug(slug) || !isSafeChapterFilename(filename) || !(await readableDoc(slug, owner))) {
      return chapterNotFound();
    }

    const filePath = await existingChapterPath(slug, filename);
    if (!filePath) {
      return chapterNotFound();
    }
    
    // Read file content
    const fileContent = await fs.readFile(filePath, 'utf-8');
    
    // Parse frontmatter
    const { content } = matter(fileContent);
    
    // Return just the content (without frontmatter) as plain text
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[docs-chapter] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to load chapter' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update chapter content (owner only)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate user
    const owner = await routeDocOwner();
    if (!owner) {
      return unauthorized('Authentication required to edit documentation');
    }

    const { slug, filename } = await params;
    
    if (!slug || !filename) {
      return NextResponse.json(
        { error: 'Project slug and filename are required' },
        { status: 400 }
      );
    }
    
    // D11s: refuse unsafe names instead of stripping them into some other doc's name
    if (!isSafeDocSlug(slug) || !isSafeChapterFilename(filename)) {
      return notFound('chapter', { identifier: 'invalid' });
    }
    const safeSlug = slug;
    const safeFilename = filename;
    
    // Get the documentation metadata to verify ownership
    const docMeta = await getProjectMeta(safeSlug);
    if (!docMeta) {
      return notFound('documentation', { identifier: safeSlug });
    }
    
    // Verify doc ownership
    if (!isDocOwner(docMeta, owner)) {
      return notOwner('documentation');
    }
    
    // Parse request body
    const body = await request.json();
    const { content } = body;
    
    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content must be a string' },
        { status: 400 }
      );
    }
    
    // Check if file exists - fall back to index.md for overview
    const targetPath = await existingChapterPath(safeSlug, safeFilename);
    if (!targetPath) {
      return notFound('chapter', { identifier: safeFilename });
    }
    
    // Read existing file to get frontmatter
    const existingContent = await fs.readFile(targetPath, 'utf-8');
    const { data: frontmatter } = matter(existingContent);
    
    // Reconstruct file with frontmatter + new content
    let newFileContent: string;
    if (Object.keys(frontmatter).length > 0) {
      // Has frontmatter - preserve it
      newFileContent = matter.stringify(content, frontmatter);
    } else {
      // No frontmatter - just use content
      newFileContent = content;
    }
    
    // Write the updated content
    await fs.writeFile(targetPath, newFileContent, 'utf-8');
    
    return success({
      updated: true,
      filename: safeFilename,
      slug: safeSlug,
    });
  } catch (error) {
    console.error('[docs-chapter] PUT Error:', error);
    return serverError(error, 'Failed to save chapter');
  }
}
