"use server";

import type { TagInfo } from "@/db/operations/tag-operations";
import { convexTagList, requireConvexData } from "@/backend/projects/personal";

// D07 (P08 R04, R30): every export of a "use server" file is callable by
// anyone. The tag writers that were here (addTagToProjectAction,
// removeTagFromProjectAction, replaceProjectTagsAction, createTagAction) and
// fetchProjectTags had no auth check and no caller left but an unused hook;
// they are removed. Project tags change through the project save and the
// admin's moderation of suggestions (tag-submissions.ts). What stays is the
// public tag list.

/**
 * Search for tags by name
 */
export async function searchTagsAction(query: string): Promise<TagInfo[]> {
  try {
    const q = typeof query === "string" ? query : "";
    // D07x: the active tags from Convex. E03: no Supabase fallback.
    requireConvexData();
    return await convexTagList(q);
  } catch (error) {
    console.error("Error searching tags:", error);
    return [];
  }
}

/**
 * Fetch all tags
 */
export async function getTags(): Promise<TagInfo[]> {
  try {
    requireConvexData();
    return await convexTagList("");
  } catch (error) {
    console.error('Error fetching tags:', error);
    throw new Error('Failed to fetch tags');
  }
}
