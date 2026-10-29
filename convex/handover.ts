// Clerk-session handover (D08d, decided 4A). A user signed in with Clerk makes
// a Better Auth login, which creates a fresh account N (convex/accounts.ts),
// then hands over once: the account U behind their Clerk subject takes over
// the Better Auth login and N goes away. Never matched by email (P07 §3.2).
//
// Convex never sees a Clerk token (Jose: no Clerk JWT template). The Next.js
// server checks the Clerk session, as every Clerk route does, and calls this
// HTTP action with two proofs:
// - the user's own Better Auth Convex token as Authorization, so the session
//   is checked here exactly as getViewer checks it; and
// - CODEDETAILS_HANDOVER_SECRET, shared only between the Next.js server and
//   this deployment, standing for "the server verified this Clerk subject".
// Without the secret configured on the deployment, everything is refused.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation } from "./_generated/server";
import { holdsOnlySignUpRows, removeSignUpAccount } from "./accounts";
import { authComponent } from "./auth";

export const SECRET_HEADER = "x-codedetails-handover-secret";
const CLERK_SUBJECT = /^user_[A-Za-z0-9_]{1,64}$/;
const MIN_SECRET_LENGTH = 32;

/** Constant-time for equal lengths; the length of a fixed secret isn't a secret. */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const handoverHttp = httpAction(async (ctx, request) => {
  const secret = process.env.CODEDETAILS_HANDOVER_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return json(404, { linked: false });
  if (!sameSecret(request.headers.get(SECRET_HEADER) ?? "", secret)) return json(403, { linked: false });
  let clerkSubject: unknown;
  try {
    clerkSubject = ((await request.json()) as { clerkSubject?: unknown }).clerkSubject;
  } catch {
    return json(400, { linked: false });
  }
  if (typeof clerkSubject !== "string" || !CLERK_SUBJECT.test(clerkSubject)) return json(400, { linked: false });
  // The Better Auth token in Authorization is propagated to the mutation,
  // which checks the session itself.
  const result = await ctx.runMutation(internal.handover.link, { clerkSubject });
  return json(result.linked ? 200 : result.reason === "no_session" ? 401 : 409, result);
});

type LinkResult = { linked: true; already: boolean } | { linked: false; reason: "no_session" | "not_linkable" };

export const link = internalMutation({
  args: { clerkSubject: v.string() },
  handler: async (ctx, { clerkSubject }): Promise<LinkResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.issuer !== process.env.CONVEX_SITE_URL) return { linked: false, reason: "no_session" };
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser || authUser._id !== identity.subject) return { linked: false, reason: "no_session" };

    const clerkLink = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "clerk").eq("subject", clerkSubject))
      .unique();
    if (!clerkLink) return { linked: false, reason: "not_linkable" };
    const target = await ctx.db.get(clerkLink.userId);
    if (!target || target.status !== "active") return { linked: false, reason: "not_linkable" };

    const current = await ctx.db
      .query("authLinks")
      .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUser._id))
      .unique();
    if (current?.userId === target._id) return { linked: true, already: true };

    // One Better Auth login per account.
    const targetLinks = await ctx.db.query("authLinks").withIndex("by_user", (q) => q.eq("userId", target._id)).collect();
    if (targetLinks.some((l) => l.provider === "better-auth")) return { linked: false, reason: "not_linkable" };

    // The fresh account the Better Auth sign-up made goes away, but only if it
    // is still just that; anything with content is never merged or deleted.
    if (current) {
      if (!(await holdsOnlySignUpRows(ctx, current.userId))) return { linked: false, reason: "not_linkable" };
      await removeSignUpAccount(ctx, current.userId);
    }
    const now = Date.now();
    await ctx.db.insert("authLinks", { userId: target._id, provider: "better-auth", subject: authUser._id, linkedAt: now });
    await ctx.db.patch(target._id, { authUserId: authUser._id });
    await ctx.db.insert("auditEvents", {
      kind: "account.linked",
      actorId: target._id,
      subjectTable: "users",
      subjectId: target._id,
      at: now,
      details: { provider: "better-auth", replacedSignUpAccount: !!current },
    });
    return { linked: true, already: false };
  },
});
