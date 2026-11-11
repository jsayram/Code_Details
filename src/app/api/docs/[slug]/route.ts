/**
 * Delete Project API Route
 * 
 * DELETE /api/docs/[slug]
 * 
 * Deletes a generated documentation project.
 * RFC 7807 compliant error responses.
 */

import { NextRequest } from 'next/server';
import { routeDocOwner } from '@/lib/auth-server';
import { isDocOwner } from '@/lib/docs-access';
import { docStore } from '@/lib/output-utils';
import { 
  unauthorized, 
  notFound, 
  notOwner, 
  serverError, 
  invalidInput,
  success 
} from '@/lib/api-errors';
import { docSlugParamSchema } from '@/lib/validations/docs';

interface RouteParams {
  params: Promise<{
    slug: string;
  }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate user
    const owner = await routeDocOwner();
    if (!owner) {
      return unauthorized('Authentication required to delete documentation');
    }

    const { slug } = await params;
    
    // Validate slug parameter
    const validation = docSlugParamSchema.safeParse({ slug });
    if (!validation.success) {
      return invalidInput('Invalid documentation slug provided');
    }

    // Get project metadata to verify ownership
    const meta = await docStore.readMeta(slug);
    
    if (!meta) {
      return notFound('documentation', { identifier: slug });
    }

    // Verify ownership
    if (!isDocOwner(meta, owner)) {
      return notOwner('documentation');
    }

    // Delete the project
    const deleted = await docStore.deleteDoc(slug);
    
    if (!deleted) {
      return serverError(undefined, 'Failed to delete documentation');
    }

    return success({ deleted: true, slug });
  } catch (error) {
    console.error('[docs-delete] Error:', error);
    return serverError(error, 'Failed to delete documentation');
  }
}
