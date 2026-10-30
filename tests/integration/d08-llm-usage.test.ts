// D08 /api/llm gate, Convex side (convex/llmUsage.ts) on the task-owned test
// backend, whose daily caps tests/convex/push.mjs sets to 3 per user and 5 in
// all. Only admins reserve; the caps hold across calls (they live in the
// database, not in a server's memory); the log has no prompt or answer; only
// the caller closes their own log row.
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { adminClient, anonymousClient, clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, personaAuthUserId } from "../fixtures/convex-auth";
import { setRole } from "../fixtures/better-auth";

type Reservation = { ok: true; callId: string; remainingToday: number } | { ok: false; code: string };
const reserve = makeFunctionReference<"mutation", { provider: string; model?: string }, Reservation>("llmUsage:reserve");
const finish = makeFunctionReference<"mutation", { callId: string; ok: boolean; latencyMs: number; errorStatus?: number }, boolean>("llmUsage:finish");
const llmState = makeFunctionReference<"query", Record<string, never>, { usage: { day: string; scope: string; count: number }[]; calls: Record<string, unknown>[] }>("fixtures:llmState");
const state = () => adminClient().query(llmState, {});

const set = generateFixtures();
const { a: A, b: B, admin } = set.personas;
const take = (subject: string) => clientAs(subject).mutation(reserve, { provider: "openai", model: "gpt-synthetic" });

describe.skipIf(!convexAvailable())("D08 /api/llm usage caps", () => {
  beforeEach(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("anonymous and non-admin callers are refused and nothing is counted", async () => {
    expect(await anonymousClient().mutation(reserve, { provider: "openai" })).toEqual({ ok: false, code: "forbidden" });
    for (const s of [A.subject!, B.subject!]) expect(await take(s)).toEqual({ ok: false, code: "forbidden" });
    expect(await state()).toEqual({ usage: [], calls: [] });
  });

  it("an admin gets 3 calls a day; the 4th is refused; the counters are stored", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await take(admin.subject!));
    expect(results.slice(0, 3).map((r) => r.ok && r.remainingToday)).toEqual([2, 1, 0]);
    expect(results[3]).toEqual({ ok: false, code: "user_cap" });
    const { usage, calls } = await state();
    expect(usage.map((u) => [u.scope.startsWith("user:") ? "user" : u.scope, u.count]).sort()).toEqual([["global", 3], ["user", 3]]);
    expect(calls).toHaveLength(3);
  });

  it("the global cap holds across admins", async () => {
    await setRole(await personaAuthUserId(B.subject!), "admin");
    for (let i = 0; i < 3; i++) expect((await take(admin.subject!)).ok).toBe(true);
    expect((await take(B.subject!)).ok).toBe(true);
    expect((await take(B.subject!)).ok).toBe(true);
    expect(await take(B.subject!)).toEqual({ ok: false, code: "global_cap" });
  });

  it("the log has who, when, provider, model and outcome, never the prompt; only its caller closes it, once", async () => {
    await setRole(await personaAuthUserId(B.subject!), "admin");
    const r = await take(admin.subject!);
    if (!r.ok) throw new Error("expected a reservation");
    expect(await clientAs(B.subject!).mutation(finish, { callId: r.callId, ok: true, latencyMs: 5 })).toBe(false);
    expect(await clientAs(admin.subject!).mutation(finish, { callId: r.callId, ok: false, latencyMs: 12.4, errorStatus: 502 })).toBe(true);
    expect(await clientAs(admin.subject!).mutation(finish, { callId: r.callId, ok: true, latencyMs: 1 })).toBe(false);
    const [row] = (await state()).calls;
    expect(Object.keys(row).sort()).toEqual(["day", "errorStatus", "id", "latencyMs", "model", "provider", "startedAt", "status", "userId"]);
    expect(row).toMatchObject({ provider: "openai", model: "gpt-synthetic", status: "error", latencyMs: 12, errorStatus: 502 });
  });
});
