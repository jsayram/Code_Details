// D07-c: tag suggestions and their moderation on Convex, behind the
// development switches (projectWritesToConvex: both switches on the same local
// backend). The Convex functions (convex/tags.ts) learn the caller from the
// Better Auth session; no user ID or email is ever sent. Answers are mapped to
// the shapes the default (Supabase) actions return, so the components don't
// change. Convex keeps no submitter emails (P07 §8): the moderation list
// carries the submitter's username in the field the UI labels "Submitted by".
// Server-side only; src/app/actions/tag-submissions.ts and the
// tag-submissions route call it.
import { makeFunctionReference } from "convex/server";
import { viewerMutation, viewerQuery, viewerQueryWithArgs } from "@/lib/auth-server";
import { MAX_PROJECT_TAGS } from "@/constants/project-limits";

type Issue = { field: string; message: string };
type SuggestResult =
  | { ok: true; status: "already" | "attached" | "pending" }
  | { ok: false; code: "not_found" | "duplicate" | "too_many_pending" }
  | { ok: false; code: "invalid"; issues: Issue[] };
type ModerateResult = { ok: true } | { ok: false; code: "not_found" | "not_pending" | "limit" } | { ok: false; code: "invalid"; issues: Issue[] };
type MySuggestion = { id: string; name: string; status: string; note: string | null; adminNotes: string | null; createdAt: number };
type PendingGroup = {
  nameKey: string;
  count: number;
  suggestions: {
    id: string;
    name: string;
    note: string | null;
    createdAt: number;
    project: { id: string; slug: string; title: string; tagCount: number } | null;
    submitterUsername: string | null;
  }[];
};

const refs = {
  suggest: makeFunctionReference<"mutation", { projectId: string; name: string; note?: string }, SuggestResult>("tags:suggest"),
  mySuggestions: makeFunctionReference<"query", { projectId: string }, MySuggestion[]>("tags:mySuggestions"),
  listPending: makeFunctionReference<"query", Record<string, never>, PendingGroup[] | null>("tags:listPending"),
  approve: makeFunctionReference<"mutation", { suggestionId: string; scope: "project" | "system"; adminNotes?: string }, ModerateResult>("tags:approve"),
  reject: makeFunctionReference<"mutation", { suggestionId: string; adminNotes?: string }, ModerateResult>("tags:reject"),
};

const iso = (ms: number) => new Date(ms).toISOString();

/** submitNewTag's answers: auto_approved / pending objects, { success: false, error } refusals, a thrown duplicate. */
export async function suggestTagOnConvex(projectId: string, tagName: string, description?: string) {
  const answer = await viewerMutation(refs.suggest, { projectId, name: tagName, ...(description ? { note: description } : {}) });
  if (!answer) return { success: false, error: "You must be signed in to suggest tags" };
  const r = answer.result;
  if (r.ok && r.status === "pending") return { status: "pending", tag_name: tagName };
  if (r.ok) {
    return {
      status: "auto_approved",
      tag_name: tagName,
      message: r.status === "already" ? "This project already has this tag" : "Tag already exists and has been added to your project",
    };
  }
  if (r.code === "duplicate") throw new Error("You already have a pending submission for this tag");
  if (r.code === "too_many_pending") return { success: false, error: "You have too many pending tag suggestions" };
  if (r.code === "invalid") return { success: false, error: r.issues[0]?.message ?? "Invalid tag" };
  return { success: false, error: "Project not found" };
}

/** The viewer's own suggestions on one project, as tag_submissions rows (status filter applied here). */
export async function mySuggestionsOnConvex(projectId: string, status: string) {
  const answer = await viewerQueryWithArgs(refs.mySuggestions, { projectId });
  return (answer?.result ?? [])
    .filter((s) => s.status === status)
    .map((s) => ({
      id: s.id,
      tag_name: s.name,
      project_id: projectId,
      description: s.note,
      status: s.status,
      admin_notes: s.adminNotes,
      created_at: iso(s.createdAt),
    }));
}

/** The admin's pending list in getPendingTagSubmissions' grouped shape. Callers check the admin first. */
export async function pendingSuggestionsOnConvex() {
  const groups = (await viewerQuery(refs.listPending))?.result ?? [];
  return groups.map((g) => ({
    tag_name: g.nameKey,
    count: g.count,
    submissions: g.suggestions.map((s) => ({
      id: s.id,
      tag_name: s.name,
      project_id: s.project?.id ?? null,
      // No emails on Convex: the "Submitted by" line shows the username.
      submitter_email: s.submitterUsername ?? "deleted account",
      description: s.note,
      status: "pending",
      created_at: new Date(s.createdAt) as Date | null,
      updated_at: null as Date | null,
      admin_notes: null as string | null,
      reviewed_at: null as Date | null,
      project_title: s.project?.title ?? null,
      project_slug: s.project?.slug ?? null,
      project_tag_count: s.project?.tagCount ?? null,
    })),
  }));
}

/** Approve or reject; throws with the default path's messages, as the UI expects. */
export async function moderateOnConvex(
  operation: "approve" | "reject",
  suggestionId: string,
  adminNotes: string | undefined,
  scope: "project" | "system" = "project",
): Promise<void> {
  const answer =
    operation === "approve"
      ? await viewerMutation(refs.approve, { suggestionId, scope, ...(adminNotes !== undefined ? { adminNotes } : {}) })
      : await viewerMutation(refs.reject, { suggestionId, ...(adminNotes !== undefined ? { adminNotes } : {}) });
  if (!answer) throw new Error("Unauthorized: User not logged in");
  const r = answer.result;
  if (r.ok) return;
  if (r.code === "limit") throw new Error(`Cannot approve tag for project - project already has the maximum of ${MAX_PROJECT_TAGS} tags`);
  if (r.code === "not_pending") throw new Error("This submission was already reviewed");
  if (r.code === "invalid") throw new Error(r.issues[0]?.message ?? "Invalid input");
  throw new Error("Submission not found");
}
