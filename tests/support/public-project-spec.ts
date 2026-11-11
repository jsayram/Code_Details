// C02: what an anonymous public read must return for each fixture, derived
// from the synthetic fixture set alone. Both readers (Supabase today, Convex
// next) are tested against this, so it is the executable form of the
// contract in src/backend/projects/public-project.ts. The ID is left out
// because each backend has its own.
import type { PublicProject } from "@/backend/projects/public-project";
import { publicCategoryData } from "@/backend/projects/public-project";
import { type FixtureSet, type Project, convexImportUsername, supabasePublicUsername } from "../fixtures/generate";

export type ExpectedPublicProject = Omit<PublicProject, "id">;

/**
 * Null means not-found: missing, private, deleted and purged all look the same.
 * The backends differ only for an email-shaped username: Supabase publishes its
 * local part, Convex the handle the import generated (P07 §5.2).
 */
export function expectedPublicProject(
  set: FixtureSet,
  slug: string,
  backend: "supabase" | "convex" = "supabase",
): ExpectedPublicProject | null {
  const p: Project | undefined = set.projects.find((x) => x.slug === slug);
  if (!p || p.purged || p.deletedAt || p.visibility !== "public") return null;
  const persona = set.personas[p.ownerKey];
  const owner = persona.profile;
  const username = (u: string) => (backend === "convex" ? convexImportUsername(persona.subject!, u) : supabasePublicUsername(u));
  const tagName = (id: string) => set.tags.find((t) => t.id === id)!.name;
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    category: p.category,
    // Display order: the order the tags were attached.
    tags: p.tagIds.map(tagName),
    links: p.urlLinks.map((l) => ({ ...l })),
    // Fixtures set no field order, so no category field is displayed or public.
    categoryData: publicCategoryData(p.categoryData, null),
    fieldOrder: null,
    favoriteCount: set.favorites.filter((f) => f.projectId === p.id).length,
    visibility: "public",
    listed: true,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    owner: owner ? { username: username(owner.username), fullName: owner.fullName, avatarUrl: owner.imageUrl } : null,
  };
}
