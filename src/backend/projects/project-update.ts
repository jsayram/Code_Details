// D02: the project update on Convex, behind the development switches. Used
// only when the personal reads already come from Convex (both switches on the
// same local backend, personalReadsFromConvex): the save goes to the
// projects:update mutation, which learns the caller from the Better Auth
// session (getViewer) and checks the contentVersion the edit page read.
// Server-side only; the server action in src/app/actions/projects.ts calls it.
import { makeFunctionReference } from "convex/server";
import { viewerMutation } from "@/lib/auth-server";
import { notOwnerError, unauthorizedError, validationError, type ActionError } from "@/lib/action-errors";
import { ErrorCode } from "@/constants/error-codes";
import type { InsertProject } from "@/db/schema/projects";
import type { Project } from "@/types/models/project";
import type { ProjectCategory } from "@/constants/project-categories";
import type { ProjectLink } from "@/types/project-links";
import type { CategoryData, Issue, ProjectPatch } from "./project-update-rules";
import { personalReadsFromConvex } from "./personal";

/** The owner's edit view (convex/projects.ts EditableProject). */
export interface EditableProject {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  categoryData: CategoryData | null;
  fieldOrder: string[] | null;
  links: { url: string; label?: string; type?: string }[];
  tags: string[];
  favoriteCount: number;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
  contentVersion: number;
  owner: { username: string; fullName: string | null; avatarUrl: string | null } | null;
}

type UpdateArgs = { projectId: string; expectedContentVersion: number; patch: ProjectPatch };
type UpdateResult =
  | { ok: true; project: EditableProject; previousSlug: string | null }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "stale"; contentVersion: number }
  | { ok: false; code: "invalid"; issues: Issue[] };

const update = makeFunctionReference<"mutation", UpdateArgs, UpdateResult>("projects:update");

export const STALE_EDIT_MESSAGE =
  "This project was changed somewhere else since you opened it. Reload the page to get the latest version, then save again.";

/** True when the project update goes to Convex (see the header). */
export function projectWritesToConvex(env: Record<string, string | undefined> = process.env): boolean {
  return personalReadsFromConvex(env);
}

/**
 * The form's fields as a closed patch. Only the editable fields are copied;
 * link entries lose the client-only reachability fields, and empty category
 * values (null/undefined) are dropped, as the Convex validator has no null.
 */
export function toProjectPatch(project: Partial<InsertProject>): ProjectPatch {
  const patch: ProjectPatch = {};
  if (project.title !== undefined) patch.title = project.title;
  if (project.slug !== undefined) patch.slug = project.slug;
  if (project.description !== undefined) patch.description = project.description;
  if (project.category !== undefined) patch.category = project.category;
  if (project.url_links !== undefined) {
    patch.links = ((project.url_links ?? []) as ProjectLink[]).map((l) => ({
      url: l.url,
      ...(l.label !== undefined && l.label !== null && { label: l.label }),
      ...(l.type !== undefined && { type: l.type }),
    }));
  }
  if (project.tags !== undefined) patch.tags = project.tags ?? [];
  if (project.category_data !== undefined) {
    const data = (project.category_data ?? null) as Record<string, unknown> | null;
    patch.categoryData = data
      ? (Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined)) as CategoryData)
      : null;
  }
  if (project.field_order !== undefined) patch.fieldOrder = (project.field_order as string[] | null) ?? null;
  return patch;
}

/** The edit view in the shape the edit page reads back (it uses slug). */
export function editableToProject(p: EditableProject): Project {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: p.description,
    category: p.category as ProjectCategory,
    tags: p.tags,
    url_links: p.links,
    category_data: p.categoryData,
    field_order: p.fieldOrder,
    total_favorites: String(p.favoriteCount),
    created_at: new Date(p.createdAt),
    updated_at: new Date(p.updatedAt),
    deleted_at: null,
    profile: {
      username: p.owner?.username ?? null,
      email_address: null,
      profile_image_url: p.owner?.avatarUrl ?? null,
      full_name: p.owner?.fullName ?? null,
      first_name: null,
      last_name: null,
    },
  } as unknown as Project;
}

export async function updateProjectOnConvex(
  projectId: string,
  project: Partial<InsertProject> & { content_version?: number },
): Promise<{ success: true; data: Project; previousSlug: string | null } | ActionError> {
  if (typeof project.content_version !== "number") {
    return { success: false, error: STALE_EDIT_MESSAGE, code: ErrorCode.VALIDATION_ERROR };
  }
  const answer = await viewerMutation(update, {
    projectId,
    expectedContentVersion: project.content_version,
    patch: toProjectPatch(project),
  });
  if (!answer) return unauthorizedError("You must be signed in to update a project");
  const r = answer.result;
  if (r.ok) return { success: true, data: editableToProject(r.project), previousSlug: r.previousSlug };
  if (r.code === "stale") return { success: false, error: STALE_EDIT_MESSAGE, code: ErrorCode.VALIDATION_ERROR };
  if (r.code === "invalid") return validationError(r.issues[0]?.message ?? "Invalid project", r.issues);
  return notOwnerError("project");
}
