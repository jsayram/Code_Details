// Account deletion (D04d, P07 §5.7, §5.11; P08 R24). A request starts a
// 14-day grace period: the account is marked deleting, its profile and
// projects are hidden and every session is signed out. Inside the grace
// period the user can sign in again and cancel, which puts everything back.
// After it, a batched purge removes what the account owned (projects through
// the one purge path in projectLifecycle.ts) and leaves a tombstone users row
// with no personal data, so audit rows still resolve.
//
// SAFETY: the purge never runs unless the deployment opted in with
// CODEDETAILS_ACCOUNT_PURGE_ALLOWED=1. Only tests/convex/push.mjs sets it, and
// only on the test backends. Everywhere else the hourly job does nothing.
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewer, resolveAccount } from "./viewer";
import { bumpListedCount } from "./projects";
import { outbox, purgeProjectNow, syncListedCopies } from "./projectLifecycle";
import {
  ACCOUNT_DELETION_GRACE_MS,
  ACCOUNT_PROJECTS_PER_STEP,
  ACCOUNT_PURGES_PER_RUN,
  ACCOUNT_ROWS_PER_STEP,
  deletionCancellable,
  deletionDue,
  purgeAllowed,
} from "../src/backend/profiles/account-deletion-rules";

const AUTH_PAGE = { cursor: null, numItems: 200 };

async function profileOf(ctx: MutationCtx, userId: Id<"users">) {
  return ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
}

async function profileOutbox(ctx: MutationCtx, userId: Id<"users">, change: "upsert" | "remove", now: number) {
  const profile = await profileOf(ctx, userId);
  if (!profile) return;
  await ctx.db.insert("contentChanges", {
    entityType: "profile",
    entityId: profile._id,
    change,
    sourceVersion: now,
    projectionVersion: 1,
    createdAt: now,
    attempts: 0,
  });
}

async function accountAudit(
  ctx: MutationCtx,
  kind: "account.deletion_requested" | "account.deletion_cancelled" | "account.deleted",
  user: Doc<"users">,
  now: number,
  actor: boolean,
) {
  await ctx.db.insert("auditEvents", {
    kind,
    ...(actor ? { actorId: user._id } : {}),
    subjectTable: "users",
    subjectId: user._id,
    at: now,
  });
}

/** One project's `listed` changed: version, tag counters, copies and outbox follow. */
async function relist(ctx: MutationCtx, project: Doc<"projects">, listed: boolean, now: number) {
  const contentVersion = project.contentVersion + 1;
  await ctx.db.patch(project._id, { listed, contentVersion });
  for (const tagId of project.tagIds) await bumpListedCount(ctx, tagId, listed ? 1 : -1);
  await syncListedCopies(ctx, project._id, "projectTags", null);
  await syncListedCopies(ctx, project._id, "favorites", null);
  await outbox(ctx, project._id, listed ? "upsert" : "remove", contentVersion, now);
}

/** Hides up to a batch of the owner's listed projects; schedules the rest. Stops if the account isn't deleting any more. */
async function hideStep(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user || user.status !== "deleting") return;
  const now = Date.now();
  const batch = await ctx.db
    .query("projects")
    .withIndex("by_owner_listed_created", (q) => q.eq("ownerId", userId).eq("listed", true))
    .take(ACCOUNT_PROJECTS_PER_STEP);
  for (const project of batch) await relist(ctx, project, false, now);
  if (batch.length === ACCOUNT_PROJECTS_PER_STEP) await ctx.scheduler.runAfter(0, internal.accountDeletion.hideProjectsStep, { userId });
}

/** Lists again, one page at a time, the owner's active public projects. Stops if the account isn't active any more. */
async function showStep(ctx: MutationCtx, userId: Id<"users">, cursor: string | null) {
  const user = await ctx.db.get(userId);
  if (!user || user.status !== "active") return;
  const now = Date.now();
  const page = await ctx.db
    .query("projects")
    .withIndex("by_owner_listed_created", (q) => q.eq("ownerId", userId).eq("listed", false))
    .paginate({ cursor, numItems: ACCOUNT_PROJECTS_PER_STEP });
  for (const project of page.page) {
    if (project.status === "active" && project.visibility === "public") await relist(ctx, project, true, now);
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.accountDeletion.showProjectsStep, { userId, cursor: page.continueCursor });
}

export const hideProjectsStep = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => hideStep(ctx, userId),
});

export const showProjectsStep = internalMutation({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, cursor }) => showStep(ctx, userId, cursor),
});

export type DeletionStatus = { status: "active" } | { status: "deleting"; deleteAfter: number; cancellable: boolean };

/** The caller's own deletion state; works for a deleting account too (D04d). */
export const myDeletionStatus = query({
  args: {},
  handler: async (ctx): Promise<DeletionStatus | null> => {
    const user = await resolveAccount(ctx);
    if (!user || (user.status !== "active" && user.status !== "deleting")) return null;
    if (user.status === "active") return { status: "active" };
    return { status: "deleting", deleteAfter: user.deleteAfter ?? 0, cancellable: deletionCancellable(user, Date.now()) };
  },
});

export const request = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: true; deleteAfter: number } | { ok: false; code: "not_signed_in" }> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return { ok: false, code: "not_signed_in" };
    const user = (await ctx.db.get(viewer.userId))!;
    const now = Date.now();
    const deleteAfter = now + ACCOUNT_DELETION_GRACE_MS;
    await ctx.db.patch(user._id, { status: "deleting", deletionRequestedAt: now, deleteAfter });
    await hideStep(ctx, user._id);
    await profileOutbox(ctx, user._id, "remove", now);
    await accountAudit(ctx, "account.deletion_requested", user, now, true);
    // Signed out everywhere (P07 §5.7). A Clerk-era session can't be ended
    // from here, but getViewer refuses a deleting account on every call.
    if (user.authUserId) {
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model: "session", where: [{ field: "userId", value: user.authUserId }] },
        paginationOpts: AUTH_PAGE,
      });
    }
    return { ok: true, deleteAfter };
  },
});

export const cancel = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: true } | { ok: false; code: "not_signed_in" | "not_deleting" | "too_late" }> => {
    const user = await resolveAccount(ctx);
    if (!user) return { ok: false, code: "not_signed_in" };
    if (user.status !== "deleting") return { ok: false, code: "not_deleting" };
    const now = Date.now();
    if (!deletionCancellable(user, now)) return { ok: false, code: "too_late" };
    await ctx.db.patch(user._id, { status: "active", deletionRequestedAt: undefined, deleteAfter: undefined });
    await showStep(ctx, user._id, null);
    await profileOutbox(ctx, user._id, "upsert", now);
    await accountAudit(ctx, "account.deletion_cancelled", user, now, true);
    return { ok: true };
  },
});

/** Hourly (convex/crons.ts). Starts the purge of up to a few due accounts; does nothing unless the deployment opted in. */
export const purgeDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ started: number; disabled: boolean }> => {
    if (!purgeAllowed(process.env)) return { started: 0, disabled: true };
    const now = Date.now();
    const candidates = await ctx.db
      .query("users")
      .withIndex("by_status_deleteAfter", (q) => q.eq("status", "deleting").gte("deleteAfter", 0).lte("deleteAfter", now))
      .take(ACCOUNT_PURGES_PER_RUN);
    let started = 0;
    for (const user of candidates) {
      if (!deletionDue(user, now)) continue;
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purgeAccountStep, { userId: user._id });
      started++;
    }
    return { started, disabled: false };
  },
});

type StepResult = "disabled" | "missing" | "not_due" | "continuing" | "done";

/**
 * One bounded step of an account purge. Re-schedules itself until the account
 * is a tombstone. Each step re-checks that the account is still due, so a
 * step can't outrun a cancel (which is only possible before the date anyway).
 */
export const purgeAccountStep = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<StepResult> => {
    if (!purgeAllowed(process.env)) return "disabled";
    const user = await ctx.db.get(userId);
    if (!user) return "missing";
    if (user.status === "deleted") return "done";
    const now = Date.now();
    if (!deletionDue(user, now)) return "not_due";
    const again = async (): Promise<StepResult> => {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purgeAccountStep, { userId });
      return "continuing";
    };

    // 1. Every project the account owns, active or deleted, through the one purge path.
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner_status_created", (q) => q.eq("ownerId", userId))
      .take(ACCOUNT_PROJECTS_PER_STEP);
    for (const project of projects) await purgeProjectNow(ctx, project, null, now);
    if (projects.length === ACCOUNT_PROJECTS_PER_STEP) return again();

    // 2. Favorites the account gave; the projects' counters go down.
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user_project", (q) => q.eq("userId", userId))
      .take(ACCOUNT_ROWS_PER_STEP);
    for (const favorite of favorites) {
      const project = await ctx.db.get(favorite.projectId);
      if (project) {
        await ctx.db.patch(project._id, {
          favoriteCount: Math.max(0, project.favoriteCount - 1),
          ...(project.ownerId !== userId && { rankingFavoriteCount: Math.max(0, project.rankingFavoriteCount - 1) }),
        });
      }
      await ctx.db.delete(favorite._id);
    }
    if (favorites.length === ACCOUNT_ROWS_PER_STEP) return again();

    // 3. Tag suggestions: pending ones go, reviewed ones lose their submitter.
    const suggestions = await ctx.db
      .query("tagSuggestions")
      .withIndex("by_submitter_created", (q) => q.eq("submitterId", userId))
      .take(ACCOUNT_ROWS_PER_STEP);
    for (const s of suggestions) {
      if (s.status === "pending") await ctx.db.delete(s._id);
      else await ctx.db.patch(s._id, { submitterId: undefined });
    }
    if (suggestions.length === ACCOUNT_ROWS_PER_STEP) return again();

    // 4. Usernames (released, no redirect), profile and provider links.
    for (const row of await ctx.db.query("usernames").withIndex("by_userId_state", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("profiles").withIndex("by_userId", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("authLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(row._id);

    // 5. The Better Auth user, its sessions and its credential accounts.
    if (user.authUserId) {
      for (const model of ["session", "account"] as const) {
        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: { model, where: [{ field: "userId", value: user.authUserId }] },
          paginationOpts: AUTH_PAGE,
        });
      }
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "user", where: [{ field: "_id", value: user.authUserId }] },
      });
    }

    // 6. Tombstone: no personal data left, so audit rows still resolve.
    await ctx.db.patch(userId, { status: "deleted", authUserId: undefined, deletionRequestedAt: undefined, deleteAfter: undefined });
    await accountAudit(ctx, "account.deleted", user, now, false);
    return "done";
  },
});
