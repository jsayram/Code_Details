// D03: project create, soft delete, restore and purge on Convex, behind the
// development switches. Used only when the project update goes to Convex
// (projectWritesToConvex: both switches on the same local backend). The
// mutations learn the caller from the Better Auth session (getViewer); no
// user ID is ever sent. Server-side only; the server actions in
// src/app/actions/projects.ts call it.
import { makeFunctionReference } from "convex/server";
import { viewerMutation } from "@/lib/auth-server";
import { notOwnerError, unauthorizedError, validationError, type ActionError } from "@/lib/action-errors";
import type { InsertProject } from "@/types/rows";
import type { Project } from "@/types/models/project";
import type { Issue, ProjectPatch } from "./project-update-rules";
import { editableToProject, toProjectPatch, type EditableProject } from "./project-update";

type CreateInput = Required<Pick<ProjectPatch, "title" | "slug" | "category">> & Omit<ProjectPatch, "title" | "slug" | "category">;
type CreateResult =
  | { ok: true; project: EditableProject }
  | { ok: false; code: "unauthorized" }
  | { ok: false; code: "invalid"; issues: Issue[] };
type LifecycleResult = { ok: true; slug: string } | { ok: false; code: "not_found" };

const refs = {
  create: makeFunctionReference<"mutation", { project: CreateInput }, CreateResult>("projectLifecycle:create"),
  softDelete: makeFunctionReference<"mutation", { projectId: string }, LifecycleResult>("projectLifecycle:softDelete"),
  restore: makeFunctionReference<"mutation", { projectId: string }, LifecycleResult>("projectLifecycle:restore"),
  purge: makeFunctionReference<"mutation", { projectId: string }, LifecycleResult>("projectLifecycle:purge"),
};

export async function createProjectOnConvex(project: InsertProject): Promise<{ success: true; data: Project } | ActionError> {
  const patch = toProjectPatch({ ...project, tags: project.tags ?? [] });
  const answer = await viewerMutation(refs.create, {
    project: { ...patch, title: project.title ?? "", slug: project.slug ?? "", category: project.category ?? "" },
  });
  if (!answer || (!answer.result.ok && answer.result.code === "unauthorized")) {
    return unauthorizedError("You must be signed in to create a project");
  }
  const r = answer.result;
  if (r.ok) return { success: true, data: editableToProject(r.project) };
  if (r.code === "invalid") return validationError(r.issues[0]?.message ?? "Invalid project", r.issues);
  return unauthorizedError("You must be signed in to create a project");
}

/** Soft delete, restore or purge. A refusal is the same NOT_OWNER answer whatever the reason. */
export async function changeLifecycleOnConvex(
  operation: "softDelete" | "restore" | "purge",
  projectId: string,
): Promise<{ success: true; slug: string } | ActionError> {
  const answer = await viewerMutation(refs[operation], { projectId });
  if (!answer) return unauthorizedError("You must be signed in to change a project");
  return answer.result.ok ? { success: true, slug: answer.result.slug } : notOwnerError("project");
}
