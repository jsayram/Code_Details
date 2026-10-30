"use server";

import { TagInfo, searchTags } from "@/db/operations/tag-operations";
import { unstable_cache } from 'next/cache';

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
    return await searchTags(typeof query === "string" ? query : "");
  } catch (error) {
    console.error("Error searching tags:", error);
    return [];
  }
}

// Cache all tags for 10 minutes
export const getCachedAllTags = unstable_cache(
  async () => searchTags(),
  ['all-tags'],
  {
    revalidate: 600, // 10 minutes
    tags: ['tags']
  }
);

/**
 * Fetch all tags
 */
export async function getTags(): Promise<TagInfo[]> {
  try {
    return await getCachedAllTags();
  } catch (error) {
    console.error('Error fetching tags:', error);
    throw new Error('Failed to fetch tags');
  }
}
