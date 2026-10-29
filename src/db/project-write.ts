// The project update against Supabase (moved here from src/db/actions.ts in
// D02, P08 R03). Deliberately not a "use server" module: Next exposes every
// export of one as a callable server action, and as exports of that file
// these wrote any column of any project with no identity check
// (updateProjectServer) and told anyone who owns what (isProjectOwner). Only
// server code calls them, after the caller's identity came from the session
// (src/app/actions/projects.ts).
import { and, eq, sql } from "drizzle-orm";
import { executeQuery } from "./server";
import { projects, type SelectProject } from "./schema/projects";
import { project_tags } from "./schema/project_tags";
import { tags } from "./schema/tags";
import { getProjectTagNames } from "./actions";
import { dedupeTags } from "@/backend/projects/project-update-rules";
import type { ProjectLink } from "@/types/project-links";

/** True when the project exists and belongs to this user. */
export async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
  return await executeQuery(async (db) => {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.user_id, userId)));
    return result[0]?.count > 0;
  });
}

/** The columns an update may write. Nothing else reaches the row (no user_id, deleted_at, total_favorites). */
export interface ProjectUpdate {
  title?: string;
  slug?: string;
  description?: string | null;
  category?: string;
  url_links?: ProjectLink[];
  tags?: string[];
  category_data?: Record<string, unknown> | null;
  field_order?: string[] | null;
}

/**
 * Updates the project and replaces its tags in one transaction (R27), so a
 * failure leaves neither half written. Tags are deduplicated by nameKey first,
 * so `React` + `react` can no longer break a save.
 */
export async function updateProjectRow(id: string, update: ProjectUpdate): Promise<SelectProject> {
  return await executeQuery(async (db) => {
    const updated = await db.transaction(async (tx) => {
      const { tags: tagNames, ...columns } = update;
      const [row] = await tx
        .update(projects)
        .set({
          ...(columns.title !== undefined && { title: columns.title }),
          ...(columns.slug !== undefined && { slug: columns.slug }),
          ...(columns.description !== undefined && { description: columns.description }),
          ...(columns.category !== undefined && { category: columns.category }),
          ...(columns.url_links !== undefined && { url_links: columns.url_links }),
          ...(columns.category_data !== undefined && { category_data: columns.category_data }),
          ...(columns.field_order !== undefined && { field_order: columns.field_order }),
          updated_at: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();
      if (!row) throw new Error(`Project with ID ${id} not found`);

      if (tagNames !== undefined) {
        await tx.delete(project_tags).where(eq(project_tags.project_id, id));
        for (const { name } of dedupeTags(tagNames).tags) {
          const [existing] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.name, name));
          const tagId = existing?.id ?? (await tx.insert(tags).values({ name }).returning({ id: tags.id }))[0].id;
          await tx.insert(project_tags).values({ project_id: id, tag_id: tagId }).onConflictDoNothing();
        }
      }
      return row;
    });
    return { ...updated, tags: await getProjectTagNames(id) };
  });
}
