// D08 /api/llm gate (Jose, 2026-10-30: "Yes, gate it"). Only admins may call
// the paid model providers. Every call first reserves one unit against a
// per-user and a global daily cap (UTC days), kept in llmDailyUsage so a
// restart doesn't reset them; Convex mutations are serializable, so two
// requests can't both take the last unit. Each call is logged in llmCalls
// without the prompt or the answer. The caller comes only from getViewer.
// Caps: CODEDETAILS_LLM_USER_DAILY_CAP / CODEDETAILS_LLM_GLOBAL_DAILY_CAP
// (deployment env), else the defaults below.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getViewer } from "./viewer";

export const DEFAULT_USER_DAILY_CAP = 50;
export const DEFAULT_GLOBAL_DAILY_CAP = 100;

/** A cap from the deployment env: a whole number 0 or more, else the default. */
export function capFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return fallback;
  return Number(value.trim());
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const short = (s: string, n: number) => s.slice(0, n);

async function counter(ctx: MutationCtx, day: string, scope: string) {
  return ctx.db
    .query("llmDailyUsage")
    .withIndex("by_day_scope", (q) => q.eq("day", day).eq("scope", scope))
    .unique();
}

async function bump(ctx: MutationCtx, day: string, scope: string, row: { _id: Id<"llmDailyUsage">; count: number } | null) {
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("llmDailyUsage", { day, scope, count: 1 });
}

export type Reservation =
  | { ok: true; callId: Id<"llmCalls">; remainingToday: number }
  | { ok: false; code: "forbidden" | "user_cap" | "global_cap" };

/** Takes one call from today's caps for an admin, and opens its log row. */
export const reserve = mutation({
  args: { provider: v.string(), model: v.optional(v.string()) },
  handler: async (ctx, { provider, model }): Promise<Reservation> => {
    const viewer = await getViewer(ctx);
    if (!viewer || viewer.role !== "admin") return { ok: false, code: "forbidden" };
    const now = Date.now();
    const day = utcDay(now);
    const userCap = capFrom(process.env.CODEDETAILS_LLM_USER_DAILY_CAP, DEFAULT_USER_DAILY_CAP);
    const globalCap = capFrom(process.env.CODEDETAILS_LLM_GLOBAL_DAILY_CAP, DEFAULT_GLOBAL_DAILY_CAP);
    const userScope = `user:${viewer.userId}`;
    const mine = await counter(ctx, day, userScope);
    const all = await counter(ctx, day, "global");
    if ((mine?.count ?? 0) >= userCap) return { ok: false, code: "user_cap" };
    if ((all?.count ?? 0) >= globalCap) return { ok: false, code: "global_cap" };
    await bump(ctx, day, userScope, mine);
    await bump(ctx, day, "global", all);
    const callId = await ctx.db.insert("llmCalls", {
      userId: viewer.userId,
      day,
      startedAt: now,
      provider: short(provider, 40),
      ...(model ? { model: short(model, 100) } : {}),
      status: "started",
    });
    return { ok: true, callId, remainingToday: userCap - (mine?.count ?? 0) - 1 };
  },
});

/** Closes the caller's own open log row with how the call ended. */
export const finish = mutation({
  args: { callId: v.string(), ok: v.boolean(), latencyMs: v.number(), errorStatus: v.optional(v.number()) },
  handler: async (ctx, { callId, ok, latencyMs, errorStatus }): Promise<boolean> => {
    const viewer = await getViewer(ctx);
    const id = ctx.db.normalizeId("llmCalls", callId);
    const row = id ? await ctx.db.get(id) : null;
    if (!viewer || !row || row.userId !== viewer.userId || row.status !== "started") return false;
    await ctx.db.patch(row._id, {
      status: ok ? "ok" : "error",
      latencyMs: Math.max(0, Math.round(latencyMs)),
      ...(ok || errorStatus === undefined ? {} : { errorStatus }),
    });
    return true;
  },
});
