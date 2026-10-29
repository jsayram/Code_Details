// Supabase/Drizzle implementation of the public project read (Phase C, C06).
// It selects only public columns, so the owner's email, subject and tier never
// leave the database on this path, and it filters deleted projects in SQL.
import { and, asc, eq, isNull } from "drizzle-orm";
import { executeQuery } from "@/db/server";
import { projects } from "@/db/schema/projects";
import { profiles } from "@/db/schema/profiles";
import { project_tags } from "@/db/schema/project_tags";
import { tags } from "@/db/schema/tags";
import type { ProjectReadBackend } from "./read";
import { type PublicProject, assertPublicProject, publicCategoryData, publicLinks } from "./public-project";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Some legacy profiles use their email address as the username. Publish only
 * the part before the "@", which is what the page showed before Phase C; the
 * contract check still refuses a full address. Convex has no such usernames:
 * its import gives them generated handles (P07 §5.2).
 */
const publicUsername = (username: string) => (username.includes("@") ? username.split("@")[0] : username);

/** Code-point order on the lowercased name; the same rule the Convex seeder uses. */
const byName = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export const supabaseProjectReader: ProjectReadBackend = {
  name: "supabase",

  // D02: no slug history on Supabase; old slugs keep giving 404 there.
  async getCurrentSlug(): Promise<string | null> {
    return null;
  },
  async getPublicProjectBySlug(slug: string): Promise<PublicProject | null> {
    return executeQuery(async (db) => {
      const rows = await db
        .select({
          id: projects.id,
          slug: projects.slug,
          title: projects.title,
          description: projects.description,
          category: projects.category,
          totalFavorites: projects.total_favorites,
          urlLinks: projects.url_links,
          categoryData: projects.category_data,
          fieldOrder: projects.field_order,
          createdAt: projects.created_at,
          updatedAt: projects.updated_at,
          ownerUsername: profiles.username,
          ownerFullName: profiles.full_name,
          ownerAvatarUrl: profiles.profile_image_url,
        })
        .from(projects)
        .leftJoin(profiles, eq(profiles.user_id, projects.user_id))
        .where(and(eq(projects.slug, slug), isNull(projects.deleted_at)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      // The source stores no tag order; display order is attach time, then name.
      const tagRows = await db
        .select({ name: tags.name, attachedAt: project_tags.created_at })
        .from(project_tags)
        .innerJoin(tags, eq(project_tags.tag_id, tags.id))
        .where(eq(project_tags.project_id, row.id))
        .orderBy(asc(project_tags.created_at));
      tagRows.sort((a, b) => (a.attachedAt?.getTime() ?? 0) - (b.attachedAt?.getTime() ?? 0) || byName(a.name, b.name));

      const fieldOrder = Array.isArray(row.fieldOrder) ? row.fieldOrder : null;
      const result: PublicProject = {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        category: row.category,
        tags: tagRows.map((t) => t.name),
        links: publicLinks(row.urlLinks),
        categoryData: publicCategoryData(row.categoryData, fieldOrder),
        fieldOrder,
        favoriteCount: Number(row.totalFavorites),
        visibility: "public",
        listed: true,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
        owner: row.ownerUsername
          ? { username: publicUsername(row.ownerUsername), fullName: row.ownerFullName, avatarUrl: row.ownerAvatarUrl }
          : null,
      };
      assertPublicProject(result);
      return result;
    });
  },
};
