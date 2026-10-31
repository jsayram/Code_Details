"use server";

// D03 (SEC-D03-EMAIL): the share button needs the signed-in user's own
// username, nothing else. It used to call getCachedUserById(userId), a
// callable action that returned any user's full profile, email included.
import { makeFunctionReference } from "convex/server";
import { personalReadsFromConvex } from "@/backend/projects/personal";
import { viewerQuery } from "@/lib/auth-server";

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null } | null>("identity:whoami");

/**
 * The session's own username: the Convex account's handle (identity:whoami).
 * Null when signed out, with no local Convex (E03: the Supabase profile read
 * is gone), or on any error.
 */
export async function getMyShareUsername(): Promise<string | null> {
  if (!personalReadsFromConvex()) return null;
  try {
    return (await viewerQuery(whoami))?.result?.username ?? null;
  } catch {
    return null;
  }
}
