// D07 (P08 R20): admin is users.role. Role changes are internal mutations
// only: no public function writes a role, so a signed-in user can't raise
// their own (the escalation tests check every public function). Each change
// writes a role.changed audit row (details: from, to, via; no email).
// - bootstrapAdmin grants the first admin and refuses once any admin exists.
//   Running it against real data is Jose's decision (a stop point); the tests
//   run it on synthetic fixtures only.
// - setRole changes a role later and refuses to remove the last admin.
// Both are run with the deployment's admin key (CLI or dashboard), never from
// the app. The target is named by profile username; an operator is not a
// session, so the audit row has no actorId.
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const role = v.union(v.literal("user"), v.literal("admin"));

async function userByUsername(ctx: MutationCtx, username: string): Promise<Doc<"users">> {
  const usernameKey = username.trim().toLowerCase();
  const profile = await ctx.db.query("profiles").withIndex("by_usernameKey", (q) => q.eq("usernameKey", usernameKey)).first();
  const user = profile ? await ctx.db.get(profile.userId) : null;
  if (!user || user.status !== "active") throw new Error("No active account with that username");
  return user;
}

async function anyAdmin(ctx: MutationCtx, except?: Doc<"users">["_id"]): Promise<boolean> {
  // Full scan, run by an operator only; users has no role index.
  const admins = await ctx.db.query("users").filter((q) => q.eq(q.field("role"), "admin")).take(10);
  return admins.some((u) => u._id !== except && u.status === "active");
}

async function changeRole(ctx: MutationCtx, user: Doc<"users">, to: Doc<"users">["role"], via: string) {
  if (user.role === to) return { changed: false };
  await ctx.db.patch(user._id, { role: to });
  await ctx.db.insert("auditEvents", {
    kind: "role.changed",
    subjectTable: "users",
    subjectId: user._id,
    at: Date.now(),
    details: { from: user.role, to, via },
  });
  return { changed: true };
}

export const bootstrapAdmin = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    if (await anyAdmin(ctx)) throw new Error("An admin already exists; use roles:setRole");
    return changeRole(ctx, await userByUsername(ctx, username), "admin", "bootstrap");
  },
});

export const setRole = internalMutation({
  args: { username: v.string(), role },
  handler: async (ctx, { username, role: to }) => {
    const user = await userByUsername(ctx, username);
    if (user.role === "admin" && to !== "admin" && !(await anyAdmin(ctx, user._id))) {
      throw new Error("Refusing to remove the last admin");
    }
    return changeRole(ctx, user, to, "operator");
  },
});
