// Server-side identity (D01, P08 rule 3). The caller is whoever the verified
// token says, resolved token subject -> authLinks -> users. Nothing else
// counts: no function takes a user, owner or viewer argument, and an email is
// never used to find an account (P07 §3.2).
//
// Until D08 the token comes from the Clerk-era provider, so links use
// provider "clerk". Convex has already checked the signature, issuer,
// audience and expiry. It does not check whether the session was revoked
// since the token was issued; Better Auth's session-validating getAuthUser
// replaces this at D08.
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export interface Viewer {
  userId: Id<"users">;
  role: Doc<"users">["role"];
  tier: Doc<"users">["tier"];
}

/**
 * The signed-in caller, or null for anyone who isn't an active, linked user:
 * anonymous, an issuer this deployment doesn't trust, a subject with no link,
 * or an account that is deleting or deleted. Callers treat null as "not
 * allowed" and must not say which of these it was.
 */
export async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  // Convex only accepts configured issuers; this keeps a second provider added
  // to auth.config.ts later from resolving through the Clerk-era links.
  if (identity.issuer !== process.env.CODEDETAILS_AUTH_ISSUER) return null;
  const link = await ctx.db
    .query("authLinks")
    .withIndex("by_provider_subject", (q) => q.eq("provider", "clerk").eq("subject", identity.subject))
    .unique();
  if (!link) return null;
  const user = await ctx.db.get(link.userId);
  if (!user || user.status !== "active") return null;
  return { userId: user._id, role: user.role, tier: user.tier };
}
