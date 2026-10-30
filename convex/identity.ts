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

// D11 (decision A): the caller's own Clerk-era subject, for the generator
// routes whose data is still keyed by Clerk user IDs. Only ever the caller's
// own: getViewer, then that user's "clerk" link. Null for anonymous callers,
// accounts without a Clerk-era link, and anything getViewer refuses. Used by
// server code only (src/lib/auth-server.ts routeUserId); never shown in the UI.
export const legacySubject = query({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const links = await ctx.db
      .query("authLinks")
      .withIndex("by_user", (q) => q.eq("userId", viewer.userId))
      .collect();
    return links.find((l) => l.provider === "clerk")?.subject ?? null;
  },
});

// Generator re-key: who owns generated docs. The caller's own account ID (the
// key new docs are written with) and, while it exists, the caller's own
// Clerk-era subject (the key older docs carry). Only ever the caller's own:
// getViewer, then that user's "clerk" link. Null for anyone getViewer refuses.
// Server code only (src/lib/auth-server.ts routeDocOwner); never shown in the UI.
export const docOwner = query({
  args: {},
  handler: async (ctx): Promise<{ userId: string; legacySubject: string | null } | null> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const links = await ctx.db
      .query("authLinks")
      .withIndex("by_user", (q) => q.eq("userId", viewer.userId))
      .collect();
    return { userId: viewer.userId, legacySubject: links.find((l) => l.provider === "clerk")?.subject ?? null };
  },
});
