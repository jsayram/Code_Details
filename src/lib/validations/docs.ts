/**
 * Zod Validation Schemas for Generated Docs API
 * 
 * Provides validation for linking documentation to projects.
 */

import { z } from 'zod';

// ============================================================================
// Link Project Schema
// ============================================================================

export const linkProjectSchema = z.object({
  // A Supabase project UUID, or (behind the development switches) a Convex
  // project ID. Either way the route checks it against the caller's own projects.
  projectId: z.union(
    [z.string().uuid(), z.string().regex(/^[0-9a-z]{25,40}$/)],
    { message: 'Project ID must be a project ID' },
  ),
  projectSlug: z
    .string()
    .min(1, 'Project slug is required')
    .max(255, 'Project slug must be at most 255 characters')
    .regex(/^[a-z0-9-]+$/, 'Project slug must be lowercase alphanumeric with hyphens'),
  projectTitle: z
    .string()
    .min(1, 'Project title is required')
    .max(255, 'Project title must be at most 255 characters'),
  replace: z
    .boolean()
    .optional()
    .default(false),
});

export type LinkProjectInput = z.infer<typeof linkProjectSchema>;

// ============================================================================
// Doc Slug Param Schema
// ============================================================================

export const docSlugParamSchema = z.object({
  slug: z
    .string()
    .min(1, 'Doc slug is required')
    .max(255, 'Doc slug must be at most 255 characters'),
});

export type DocSlugParam = z.infer<typeof docSlugParamSchema>;

// ============================================================================
// Error Formatting Helper
// ============================================================================

/**
 * Format Zod errors into a consistent structure for API responses
 */
export function formatZodErrors(error: z.ZodError): Array<{ 
  field: string; 
  message: string; 
  received?: unknown 
}> {
  return error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
    received: 'input' in err ? err.input : undefined,
  }));
}
