// App account rows for Better Auth users (D08c). createAccountRows runs inside
// the component's user.onCreate trigger (convex/auth.ts), in the same
// transaction as the auth user's insert, so a new auth user always comes with
// its users, authLinks, profiles and usernames rows, or not at all.
//
// Seeding follows P07 §5.4 (decided): the provider's name and avatar are copied
// once, here, and never again. The username is always a generated handle
// (§5.2); renaming is D04b. Nothing here reads or stores the email, except to
// refuse a name that is the address.
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { randomHandle, seedAvatar, seedFullName } from "./accountRules";

/** Whether nobody holds the key: no current claim, no live reservation, no profile. */
async function handleFree(ctx: MutationCtx, key: string, now: number): Promise<boolean> {
  const current = await ctx.db
    .query("usernames")
    .withIndex("by_usernameKey_state", (q) => q.eq("usernameKey", key).eq("state", "current"))
    .first();
  if (current) return false;
  const previous = await ctx.db
    .query("usernames")
    .withIndex("by_usernameKey_state", (q) => q.eq("usernameKey", key).eq("state", "previous"))
    .collect();
  if (previous.some((p) => (p.reservedUntil ?? 0) > now)) return false;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_usernameKey", (q) => q.eq("usernameKey", key))
    .first();
  return !profile;
}

export interface NewAuthUser {
  _id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export async function createAccountRows(ctx: MutationCtx, authUser: NewAuthUser): Promise<Id<"users"> | null> {
  const existing = await ctx.db
    .query("authLinks")
    .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUser._id))
    .unique();
  if (existing) return null;
  const now = Date.now();
  let handle: string | null = null;
  // 36^6 ≈ 2.2 billion handles; a few tries is plenty, and running out throws,
  // which rolls back the auth user's insert too.
  for (let i = 0; i < 8 && !handle; i++) {
    const candidate = randomHandle();
    if (await handleFree(ctx, candidate, now)) handle = candidate;
  }
  if (!handle) throw new Error("could not generate a free username");
  const userId = await ctx.db.insert("users", { authUserId: authUser._id, role: "user", tier: "free", status: "active", createdAt: now });
  await ctx.db.insert("authLinks", { userId, provider: "better-auth", subject: authUser._id, linkedAt: now });
  const fullName = seedFullName(authUser.name, authUser.email);
  const avatar = seedAvatar(authUser.image);
  await ctx.db.insert("profiles", {
    userId,
    username: handle,
    usernameKey: handle,
    ...(fullName ? { fullName } : {}),
    ...(avatar ? { avatar } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("usernames", { usernameKey: handle, userId, state: "current", claimedAt: now });
  return userId;
}

const HOUR_MS = 60 * 60 * 1000;
const PAGE = { cursor: null, numItems: 200 };

/**
 * Removes half-finished sign-ups (D08c). Better Auth writes the auth user, its
 * credential account and its session in separate mutations; if a later one
 * fails, an auth user is left with no account. It can't sign in, and it still
 * holds the email address. This removes such auth users created in
 * [createdAfter, createdBefore) (default: between 25 and 1 hours ago, so the
 * hourly cron sees each one about once), with their sessions and app rows.
 * It only does that while the app account holds nothing beyond what sign-up
 * made. Anything else is skipped and counted, never deleted.
 */
export const repairHalfFinishedSignUps = internalMutation({
  args: { createdBefore: v.optional(v.number()), createdAfter: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const before = args.createdBefore ?? now - HOUR_MS;
    const after = args.createdAfter ?? now - 25 * HOUR_MS;
    const candidates = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      where: [
        { field: "createdAt", operator: "lt", value: before },
        { field: "createdAt", operator: "gte", value: after },
      ],
      paginationOpts: PAGE,
    });
    let removed = 0;
    let kept = 0;
    for (const authUser of candidates.page as { _id: string }[]) {
      const accounts = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "account",
        where: [{ field: "userId", value: authUser._id }],
        paginationOpts: { cursor: null, numItems: 1 },
      });
      if (accounts.page.length > 0) continue;
      const link = await ctx.db
        .query("authLinks")
        .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUser._id))
        .unique();
      const userId = link?.userId;
      if (userId && !(await holdsOnlySignUpRows(ctx, userId))) {
        kept++;
        continue;
      }
      if (userId) await removeSignUpAccount(ctx, userId);
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model: "session", where: [{ field: "userId", value: authUser._id }] },
        paginationOpts: PAGE,
      });
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "user", where: [{ field: "_id", value: authUser._id }] },
      });
      removed++;
    }
    return { removed, kept };
  },
});

/**
 * Deletes an app account made by sign-up: its usernames, profiles, authLinks and
 * users row. Callers check holdsOnlySignUpRows first.
 */
export async function removeSignUpAccount(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  for (const row of await ctx.db.query("usernames").withIndex("by_userId_state", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query("authLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(row._id);
  await ctx.db.delete(userId);
}

/** Every image belongs to a project, so projects cover images too. */
export async function holdsOnlySignUpRows(ctx: MutationCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || user.status !== "active" || user.role !== "user") return false;
  const links = await ctx.db.query("authLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  if (links.some((l) => l.provider !== "better-auth")) return false;
  if (await ctx.db.query("projects").withIndex("by_owner_status_created", (q) => q.eq("ownerId", userId)).first()) return false;
  if (await ctx.db.query("favorites").withIndex("by_user_project", (q) => q.eq("userId", userId)).first()) return false;
  if (await ctx.db.query("tagSuggestions").withIndex("by_submitter_created", (q) => q.eq("submitterId", userId)).first()) return false;
  const names = await ctx.db.query("usernames").withIndex("by_userId_state", (q) => q.eq("userId", userId)).collect();
  return names.every((n) => n.state === "current");
}
