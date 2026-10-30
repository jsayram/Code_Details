// D08 /api/llm gate, route side. No real provider: @/llm is a double. Only an
// admin session reaches a provider, and only after Convex reserved a unit of
// today's caps; a refusal, a missing check or a bad body calls nothing. The
// usage log gets the outcome, never the prompt.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "admin" as string | null,
  account: 0,
  reservation: { ok: true, callId: "call-1", remainingToday: 2 } as unknown,
  mutations: [] as { name: string; args: Record<string, unknown> }[],
  llmCalls: [] as unknown[],
  llmFails: false,
}));
const refName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
vi.mock("@/lib/auth-server", () => ({
  betterAuthRole: async () => h.role,
  // A fresh account per request, so the in-memory 2 s throttle stays out of the way.
  routeDocOwner: async () => (h.role ? { writeKey: `acct-${++h.account}` } : null),
  viewerMutation: async (ref: unknown, args: Record<string, unknown>) => {
    const name = refName(ref);
    h.mutations.push({ name, args });
    if (/reserve/.test(name)) return h.reservation === undefined ? null : { result: h.reservation };
    return { result: true };
  },
}));
vi.mock("@/llm", () => ({
  PROVIDER_IDS: { OPENAI: "openai" },
  callLLM: async (args: unknown) => {
    h.llmCalls.push(args);
    if (h.llmFails) throw new Error("synthetic provider failure");
    return { text: "synthetic answer" };
  },
}));

import { POST } from "@/app/api/llm/route";

const PROMPT = "SYNTHETIC-PROMPT-must-not-be-logged";
const post = (body: unknown = { prompt: PROMPT, provider: "openai", model: "gpt-synthetic" }) =>
  POST(new NextRequest("http://localhost:3000/api/llm", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(h, { role: "admin", reservation: { ok: true, callId: "call-1", remainingToday: 2 }, mutations: [], llmCalls: [], llmFails: false });
});

describe("/api/llm gate", () => {
  it("signed out: 401, nothing reserved or called", async () => {
    h.role = null;
    expect((await post()).status).toBe(401);
    expect(h.mutations).toEqual([]);
    expect(h.llmCalls).toEqual([]);
  });

  it("a signed-in non-admin: 403, nothing reserved or called", async () => {
    h.role = "user";
    expect((await post()).status).toBe(403);
    expect(h.mutations).toEqual([]);
    expect(h.llmCalls).toEqual([]);
  });

  it("a bad body is refused before a unit is taken", async () => {
    expect((await post({ provider: "openai" })).status).toBe(400);
    expect(h.mutations).toEqual([]);
  });

  it.each([
    ["the user's cap", { ok: false, code: "user_cap" }, 429],
    ["the global cap", { ok: false, code: "global_cap" }, 429],
    ["Convex says not an admin", { ok: false, code: "forbidden" }, 403],
    ["the check is unavailable", undefined, 503],
  ])("%s: refused (%#), no provider call", async (_name, reservation, status) => {
    h.reservation = reservation;
    expect((await post()).status).toBe(status);
    expect(h.llmCalls).toEqual([]);
  });

  it("an admin within the caps: one provider call, logged as ok without the prompt", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.llmCalls).toHaveLength(1);
    expect(h.mutations.map((m) => m.name)).toEqual([expect.stringMatching(/reserve/), expect.stringMatching(/finish/)]);
    expect(h.mutations[1].args).toMatchObject({ callId: "call-1", ok: true });
    expect(JSON.stringify(h.mutations)).not.toContain(PROMPT);
  });

  it("a provider failure is logged as an error, still without the prompt", async () => {
    h.llmFails = true;
    const res = await post();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.mutations[1].args).toMatchObject({ callId: "call-1", ok: false });
    expect(JSON.stringify(h.mutations)).not.toContain(PROMPT);
  });
});
