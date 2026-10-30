// D05: favorite and unfavorite on Convex, behind the development switches.
// Used only when project writes go to Convex (projectWritesToConvex: both
// switches on the same local backend). The mutations learn the caller from
// the Better Auth session (getViewer); no user ID is ever sent. Server-side
// only; the server actions in src/app/actions/projects.ts call it.
import { makeFunctionReference } from "convex/server";
import { viewerMutation } from "@/lib/auth-server";
import { notFoundError, unauthorizedError, type ActionError } from "@/lib/action-errors";
import { ErrorCode } from "@/constants/error-codes";

type FavoriteResult = { ok: true; isFavorite: boolean; favoriteCount: number } | { ok: false; code: "not_found" };

const refs = {
  add: makeFunctionReference<"mutation", { projectId: string }, FavoriteResult>("favorites:add"),
  remove: makeFunctionReference<"mutation", { projectId: string }, FavoriteResult>("favorites:remove"),
};

/** Same answers as the Supabase path: UNAUTHORIZED when signed out, PROJECT_NOT_FOUND for a project the caller can't favorite. */
export async function changeFavoriteOnConvex(
  operation: "add" | "remove",
  projectId: string,
): Promise<{ success: true } | ActionError> {
  const answer = await viewerMutation(refs[operation], { projectId });
  if (!answer) return unauthorizedError("You must be signed in to favorite a project");
  return answer.result.ok ? { success: true } : notFoundError("Project", ErrorCode.PROJECT_NOT_FOUND);
}
