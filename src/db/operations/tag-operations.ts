import { eq, sql, desc } from "drizzle-orm";
import { executeQuery } from "../server";
import { project_tags } from "../schema/project_tags";
import { tags as tagsTable } from "../schema/tags";
import { projects } from "../schema/projects";
import { z } from "zod";

export const ContentType = z.enum([
  "project",
  "tutorial",
  "page",
  "snippet",
]);

export type ContentType = z.infer<typeof ContentType>;

export interface TagInfo {
  id: string;
  name: string;
  count?: number; // Optional count for tag usage statistics
}

import { TAG_CACHE_DURATION_MS, MAX_TAGS_QUERY_RESULTS } from '@/constants/project-limits';

// Cache structure for tag queries with improved typing
const tagQueryCache = new Map<string, { tags: TagInfo[]; timestamp: number }>();
// Promise cache to prevent duplicate queries (cache stampede fix)
const pendingQueries = new Map<string, Promise<TagInfo[]>>();
const CACHE_DURATION = TAG_CACHE_DURATION_MS;

// Helper to get cached tags or fetch from database
async function getOrFetchTags(query: string = ''): Promise<TagInfo[]> {
  const cacheKey = query.toLowerCase();
  const now = Date.now();
  const cached = tagQueryCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.tags;
  }

  // Check if query is already pending (prevents cache stampede)
  const pending = pendingQueries.get(cacheKey);
  if (pending) {
    return pending;
  }

  // Create and cache the query promise
  const queryPromise = executeQuery(async (db) => {
    const baseQuery = db
      .select({
        id: tagsTable.id,
        name: tagsTable.name,
        count: sql<number>`COUNT(DISTINCT CASE WHEN ${project_tags.project_id} IS NOT NULL AND projects.deleted_at IS NULL THEN ${project_tags.project_id} ELSE NULL END)::int`
      })
      .from(tagsTable)
      .leftJoin(project_tags, eq(project_tags.tag_id, tagsTable.id))
      .leftJoin(projects, eq(project_tags.project_id, projects.id))
      .groupBy(tagsTable.id, tagsTable.name)
      .orderBy(desc(sql<number>`COUNT(DISTINCT CASE WHEN ${project_tags.project_id} IS NOT NULL AND projects.deleted_at IS NULL THEN ${project_tags.project_id} ELSE NULL END)`), desc(tagsTable.name))
      .limit(MAX_TAGS_QUERY_RESULTS);

    if (query) {
      return await baseQuery.where(sql`${tagsTable.name} ILIKE ${`%${query}%`}`);
    }
    
    return await baseQuery;
  }).then(tags => {
    // Update cache with results
    tagQueryCache.set(cacheKey, { tags, timestamp: Date.now() });
    // Remove from pending queries
    pendingQueries.delete(cacheKey);
    return tags;
  }).catch(error => {
    // Remove from pending queries on error
    pendingQueries.delete(cacheKey);
    throw error;
  });

  // Store pending query
  pendingQueries.set(cacheKey, queryPromise);
  
  return queryPromise;
}

// Optimized tag search with caching
export async function searchTags(query: string = ''): Promise<TagInfo[]> {
  return getOrFetchTags(query);
}

// D07 (P08 R30): the unused project_tags writers that lived here (findOrCreateTags,
// replaceContentTags, addTagToContent, removeTagFromContent) and getTagsForContent
// are gone with their only callers. Project saves (src/db/project-write.ts) and
// moderation (src/app/actions/tag-submissions.ts) are the Supabase writers left.
