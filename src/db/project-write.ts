// The project writes against Supabase: update (moved here from
// src/db/actions.ts in D02, P08 R03) and create, soft delete, restore and
// purge (D03). Deliberately not a "use server" module: Next exposes every
// export of one as a callable server action, and as exports of that file
// these wrote any column of any project with no identity check
// (updateProjectServer, createProjectServer, deleteProjectServer) and told
// anyone who owns what (isProjectOwner). Only server code calls them, after
// the caller's identity came from the session (src/app/actions/projects.ts).
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
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

/** The columns a create may write; the owner comes from the session, everything else from defaults. */
export interface ProjectInsert {
  title: string;
  slug: string;
  description?: string | null;
  category: string;
  url_links?: ProjectLink[];
  tags?: string[];
  category_data?: Record<string, unknown> | null;
  field_order?: string[] | null;
}

/**
 * D03 (R03, SEC-D02-MASS): inserts a project owned by `ownerUserId` with only
 * the whitelisted columns (no id, deleted_at, total_favorites or timestamps
 * from the input), and its tags, in one transaction. Tags are deduplicated by
 * nameKey as in the update.
 */
export async function insertProjectRow(ownerUserId: string, input: ProjectInsert): Promise<SelectProject> {
  return await executeQuery(async (db) => {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({
          user_id: ownerUserId,
          title: input.title,
          slug: input.slug,
          description: input.description ?? null,
          category: input.category,
          url_links: input.url_links ?? null,
          category_data: input.category_data ?? null,
          field_order: input.field_order ?? null,
        })
        .returning();
      for (const { name } of dedupeTags(input.tags ?? []).tags) {
        const [existing] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.name, name));
        const tagId = existing?.id ?? (await tx.insert(tags).values({ name }).returning({ id: tags.id }))[0].id;
        await tx.insert(project_tags).values({ project_id: row.id, tag_id: tagId }).onConflictDoNothing();
      }
      return row;
    });
    return { ...created, tags: await getProjectTagNames(created.id) };
  });
}

/** D03: active -> deleted. Null when the project is missing or already deleted. */
export async function softDeleteProjectRow(id: string): Promise<SelectProject | null> {
  return await executeQuery(async (db) => {
    const [row] = await db
      .update(projects)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(projects.id, id), isNull(projects.deleted_at)))
      .returning();
    return row ? { ...row, tags: await getProjectTagNames(id) } : null;
  });
}

/** D03 (P07 §5.11): restore is valid only from deleted. Null otherwise. */
export async function restoreProjectRow(id: string): Promise<SelectProject | null> {
  return await executeQuery(async (db) => {
    const [row] = await db
      .update(projects)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(and(eq(projects.id, id), isNotNull(projects.deleted_at)))
      .returning();
    return row ? { ...row, tags: await getProjectTagNames(id) } : null;
  });
}

/**
 * D03: permanent deletion, only from deleted. The foreign keys remove the
 * project's tags, favorites and image rows; tag submissions keep a null
 * project. Image files in Supabase Storage are not removed here (they never
 * were); the Convex purge schedules their deletion. False when nothing was
 * deleted.
 */
export async function purgeProjectRow(id: string): Promise<boolean> {
  return await executeQuery(async (db) => {
    const rows = await db
      .delete(projects)
      .where(and(eq(projects.id, id), isNotNull(projects.deleted_at)))
      .returning({ id: projects.id });
    return rows.length > 0;
  });
}
