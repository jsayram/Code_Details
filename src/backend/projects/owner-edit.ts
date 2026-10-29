// D02: the project page's owner view and old-slug redirect on Convex, behind
// the development switches. Server-side only.
//
// - ownProjectForEdit: when the save goes to Convex (projectWritesToConvex),
//   a signed-in owner gets their own project from projects:getMineForEdit,
//   with the contentVersion the save sends back. The page props carry the
//   caller's own auth subject as the owner's user ID, which is what
//   ProjectContent compares with the session's user ID to show the edit
//   controls; nobody else ever gets this view.
// - currentSlugFor: under the Convex read switch, an old slug's current slug
//   (projects:currentSlug), so old links redirect instead of 404 (P08 R28).
import { makeFunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";
import { viewerQueryWithArgs } from "@/lib/auth-server";
import type { SelectProjectWithOwner, SelectUserWithProject } from "@/db/schema/projects";
import type { ProjectLink } from "@/types/project-links";
import { chooseProjectReadBackend, getProjectReadBackend } from "./index";
import { projectWritesToConvex, type EditableProject } from "./project-update";

type Mine = EditableProject & { viewerAuthSubject: string };
const getMineForEdit = makeFunctionReference<"query", { slug: string }, Mine | null>("projects:getMineForEdit");
const currentSlug = makeFunctionReference<"query", { slug: string }, string | null>("projects:currentSlug");

/** The edit view as the props ProjectContent takes, with the version it must send back. */
export function toOwnerContentProps(p: Mine): {
  project: SelectProjectWithOwner & { content_version: number };
  userProfile: SelectUserWithProject | null;
} {
  const project = {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: p.description,
    category: p.category,
    total_favorites: String(p.favoriteCount),
    url_links: p.links as ProjectLink[],
    category_data: p.categoryData,
    field_order: p.fieldOrder,
    created_at: new Date(p.createdAt),
    updated_at: new Date(p.updatedAt),
    deleted_at: null,
    tags: p.tags,
    user_id: p.viewerAuthSubject,
    owner_user_id: p.viewerAuthSubject,
    owner_username: p.owner?.username ?? null,
    owner_full_name: p.owner?.fullName ?? null,
    owner_profile_image_url: p.owner?.avatarUrl ?? null,
    content_version: p.contentVersion,
  } as unknown as SelectProjectWithOwner & { content_version: number };
  const userProfile = {
    user_id: p.viewerAuthSubject,
    username: p.owner?.username ?? null,
    full_name: p.owner?.fullName ?? null,
    profile_image_url: p.owner?.avatarUrl ?? null,
  } as unknown as SelectUserWithProject;
  return { project, userProfile };
}

/** The signed-in owner's own project for the edit page, or null (switch off, not the owner, not signed in). */
export async function ownProjectForEdit(slug: string) {
  if (!projectWritesToConvex()) return null;
  try {
    const mine = (await viewerQueryWithArgs(getMineForEdit, { slug }))?.result ?? null;
    return mine ? toOwnerContentProps(mine) : null;
  } catch {
    return null;
  }
}

/** Where an old slug points now, under the Convex read switch; null otherwise. */
export async function currentSlugFor(slug: string): Promise<string | null> {
  const read = chooseProjectReadBackend();
  if (read.backend !== "convex") return null;
  try {
    if (chooseAuthBackend().backend === "better-auth") {
      return (await viewerQueryWithArgs(currentSlug, { slug }))?.result ?? null;
    }
    return await getProjectReadBackend().getCurrentSlug(slug);
  } catch {
    return null;
  }
}
