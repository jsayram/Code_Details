"use server";

// D03 (SEC-D03-EMAIL): the share button needs the signed-in user's own
// username, nothing else. It used to call getCachedUserById(userId), a
// callable action that returned any user's full profile, email included.
import { eq } from "drizzle-orm";
import { executeQuery } from "@/db/server";
import { profiles } from "@/db/schema/profiles";
import { routeViewer } from "@/lib/auth-server";

/** The session's own username, or null when signed out or not synced yet. */
export async function getMyShareUsername(): Promise<string | null> {
  const viewer = await routeViewer();
  if (!viewer) return null;
  const [row] = await executeQuery((db) =>
    db.select({ username: profiles.username }).from(profiles).where(eq(profiles.user_id, viewer.userId)).limit(1),
  );
  return row?.username ?? null;
}
