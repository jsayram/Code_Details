// D05: favorite and unfavorite against Supabase. Deliberately not a "use
// server" module (see project-write.ts): only server code calls these, after
// the caller's profile came from the session (src/app/actions/projects.ts).
//
// The counter moves by exactly the number of favorite rows inserted or
// deleted, in the same transaction (P08 R25). The unique (profile_id,
// project_id) constraint plus ON CONFLICT DO NOTHING makes a repeated or
// concurrent add a no-op instead of a second row or an error. Both writes
// lock the project row first (FOR UPDATE), so changes to one project's
// favorites run one after another and can't deadlock on the counter.
//
// R31 residual: the projects table's set_timestamp trigger stamps updated_at
// on every UPDATE, so the counter change still moves it. Fixing that needs a
// schema change to Jose's database; the Convex path doesn't touch updatedAt.
import { and, eq, isNull, sql } from "drizzle-orm";
import { executeQuery } from "./server";
import { projects } from "./schema/projects";
import { favorites } from "./schema/favorites";

/**
 * Favorite an active project. "missing" when the project doesn't exist or is
 * deleted; otherwise whether a row was actually added.
 */
export async function addFavoriteRow(profileId: string, projectId: string): Promise<"added" | "unchanged" | "missing"> {
  return await executeQuery((db) =>
    db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deleted_at)))
        .for("update");
      if (!project) return "missing";
      const inserted = await tx
        .insert(favorites)
        .values({ project_id: projectId, profile_id: profileId })
        .onConflictDoNothing({ target: [favorites.profile_id, favorites.project_id] })
        .returning({ id: favorites.id });
      if (inserted.length === 0) return "unchanged";
      await tx
        .update(projects)
        .set({ total_favorites: sql`total_favorites + ${inserted.length}` })
        .where(eq(projects.id, projectId));
      return "added";
    }),
  );
}

/** Unfavorite. Works on a deleted project too. False when there was no row. */
export async function removeFavoriteRow(profileId: string, projectId: string): Promise<boolean> {
  return await executeQuery((db) =>
    db.transaction(async (tx) => {
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
      const deleted = await tx
        .delete(favorites)
        .where(and(eq(favorites.project_id, projectId), eq(favorites.profile_id, profileId)))
        .returning({ id: favorites.id });
      if (deleted.length === 0) return false;
      // Floored at 0: counters that drifted before D05 can be lower than the rows.
      await tx
        .update(projects)
        .set({ total_favorites: sql`GREATEST(total_favorites - ${deleted.length}, 0)` })
        .where(eq(projects.id, projectId));
      return true;
    }),
  );
}
