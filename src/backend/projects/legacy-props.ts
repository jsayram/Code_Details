// Maps the C02 public contract onto the props ProjectContent already takes
// (Phase C, C04), so the page renders exactly as before without changing the
// component. Only public fields are filled in: no owner email, provider
// subject, profile UUID or tier reaches the client, and isOwner stays false
// because userProfile carries no user_id (this path serves anonymous visitors).
import type { SelectProjectWithOwner, SelectUserWithProject } from "@/db/schema/projects";
import type { ProjectLink } from "@/types/project-links";
import type { PublicProject } from "./public-project";

export function toProjectContentProps(p: PublicProject): {
  project: SelectProjectWithOwner;
  userProfile: SelectUserWithProject | null;
} {
  const project = {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: p.description,
    category: p.category,
    // The page prints this value as-is; the Supabase column is a numeric string.
    total_favorites: String(p.favoriteCount),
    url_links: p.links as ProjectLink[],
    category_data: p.categoryData,
    field_order: p.fieldOrder,
    created_at: p.createdAt ? new Date(p.createdAt) : null,
    updated_at: p.updatedAt ? new Date(p.updatedAt) : null,
    deleted_at: null,
    tags: p.tags,
    owner_username: p.owner?.username ?? null,
    owner_full_name: p.owner?.fullName ?? null,
    owner_profile_image_url: p.owner?.avatarUrl ?? null,
  } as SelectProjectWithOwner;

  const userProfile = p.owner
    ? ({
        username: p.owner.username,
        full_name: p.owner.fullName,
        profile_image_url: p.owner.avatarUrl,
      } as unknown as SelectUserWithProject)
    : null;

  return { project, userProfile };
}
