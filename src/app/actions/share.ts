"use server";

// D03 (SEC-D03-EMAIL): the share button needs the signed-in user's own
// username, nothing else. It used to call getCachedUserById(userId), a
// callable action that returned any user's full profile, email included.
import { eq } from "drizzle-orm";
import { executeQuery } from "@/db/server";
import { profiles } from "@/db/schema/profiles";
import { makeFunctionReference } from "convex/server";
import { projectWritesToConvex } from "@/backend/projects/project-update";
import { routeViewer, viewerQuery } from "@/lib/auth-server";

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null } | null>("identity:whoami");

/**
 * The session's own username, or null when signed out or not synced yet.
 * DEF-FLIP-FRESHACCT (D08g4f2): under the Convex data default it is the
 * Convex account's handle (identity:whoami), so an account with no Clerk-era
 * subject can share too; on Supabase, the Clerk-era profile's.
 */
export async function getMyShareUsername(): Promise<string | null> {
  if (projectWritesToConvex()) {
    try {
      return (await viewerQuery(whoami))?.result?.username ?? null;
    } catch {
      return null;
    }
  }
  const viewer = await routeViewer();
  if (!viewer) return null;
  const [row] = await executeQuery((db) =>
    db.select({ username: profiles.username }).from(profiles).where(eq(profiles.user_id, viewer.userId)).limit(1),
  );
  return row?.username ?? null;
}
