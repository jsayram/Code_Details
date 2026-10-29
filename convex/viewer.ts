// Server-side identity (D01, D08a, P08 rule 3). The caller is whoever a
// verified token says, resolved token subject -> authLinks -> users. Nothing
// else counts: no function takes a user, owner or viewer argument, and an
// email is never used to find an account (P07 §3.2).
//
// Two issuers are trusted (convex/auth.config.ts), and the issuer decides
// which links a token may use:
// - Better Auth (D08a): the token must also name a session that still exists,
//   hasn't expired and belongs to the token's subject. That is the component's
//   session-validating safeGetAuthUser, so signing out or revoking a session
//   ends access before the token itself expires. Links use "better-auth".
// - The Clerk-era synthetic issuer (D01, until D08g): Convex has checked the
//   signature, issuer, audience and expiry, but not revocation. Links use
//   "clerk".
// The issuer check comes first because safeGetAuthUser trusts any token's
// sessionId and subject claims, whoever signed it.
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";

export interface Viewer {
  userId: Id<"users">;
  role: Doc<"users">["role"];
  tier: Doc<"users">["tier"];
}

/**
 * The signed-in caller, or null for anyone who isn't an active, linked user:
 * anonymous, an issuer this deployment doesn't trust, a Better Auth session
 * that was signed out, revoked or has expired, a subject with no link, or an
 * account that is deleting or deleted. Callers treat null as "not
 * allowed" and must not say which of these it was.
 */
export async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const user = await resolveAccount(ctx);
  if (!user || user.status !== "active") return null;
  return { userId: user._id, role: user.role, tier: user.tier };
}

/**
 * The caller's account whatever its status, or null when the token doesn't
 * resolve to a linked account. Only the account-deletion functions use it
 * (D04d: a deleting account may see its own deletion date and cancel it);
 * everything else goes through getViewer, which refuses deleting accounts.
 */
export async function resolveAccount(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  let provider: Doc<"authLinks">["provider"];
  if (identity.issuer === process.env.CONVEX_SITE_URL) {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser || authUser._id !== identity.subject) return null;
    provider = "better-auth";
  } else if (identity.issuer === process.env.CODEDETAILS_AUTH_ISSUER) {
    provider = "clerk";
  } else {
    return null;
  }
  const link = await ctx.db
    .query("authLinks")
    .withIndex("by_provider_subject", (q) => q.eq("provider", provider).eq("subject", identity.subject))
    .unique();
  if (!link) return null;
  return await ctx.db.get(link.userId);
}
