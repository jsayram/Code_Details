// Who am I (D01). The smallest read that goes through getViewer, so the
// identity bridge can be tested end to end before any write uses it. Returns
// only what the caller may know about themself: no email, no provider subject.
import { query } from "./_generated/server";
import { getViewer } from "./viewer";

export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", viewer.userId))
      .first();
    return { username: profile?.username ?? null, role: viewer.role, tier: viewer.tier };
  },
});

// Generator re-key: who owns generated docs: the caller's own account ID (the
// key docs are written with). Only ever the caller's own, from getViewer; null
// for anyone getViewer refuses. Server code only (src/lib/auth-server.ts
// routeDocOwner); never shown in the UI. E03: the Clerk-era subject (the
// legacy key, legacySubject and clerkSubjectMap) is gone with the clerk links.
export const docOwner = query({
  args: {},
  handler: async (ctx): Promise<{ userId: string } | null> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return { userId: viewer.userId };
  },
});
