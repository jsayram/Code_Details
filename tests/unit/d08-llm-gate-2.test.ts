// D08 llm-gate-2: the /api/llm rules on every route that reaches a model
// provider. No real provider: repo-docs/llm/server, the engine's LLM client and the docs
// flow are doubles.
// - /api/llm-test and /api/generate-docs: admins only, a custom base URL only
//   to this machine, one reserved unit per provider call (refused or unchecked:
//   no call), and nothing about keys in the logs.
// - The docs flow calls models only through guardedCallLLM.
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "admin" as string | null,
  account: 0,
  reservation: { ok: true, callId: "call-1", remainingToday: 2 } as unknown,
  mutations: [] as { name: string; args: Record<string, unknown> }[],
  providerCalls: [] as unknown[],
  flowShared: null as null | Record<string, unknown>,
}));
const refName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
vi.mock("@/lib/auth-server", () => ({
  betterAuthRole: async () => h.role,
  routeDocOwner: async () => (h.role ? { writeKey: `acct-${++h.account}` } : null),
  viewerMutation: async (ref: unknown, args: Record<string, unknown>) => {
    h.mutations.push({ name: refName(ref), args });
    if (/reserve/.test(refName(ref))) return h.reservation === undefined ? null : { result: h.reservation };
    return { result: true };
  },
}));
vi.mock("repo-docs/llm/server", () => ({
  testProviderConnection: async (args: unknown) => {
    h.providerCalls.push(args);
    return { success: true, message: "synthetic ok" };
  },
}));
// nodes.ts calls the client through its own relative import, so the double
// replaces that module inside the package.
vi.mock("../../packages/repo-docs/src/llm/client", () => ({
  callLLM: async (args: unknown) => {
    h.providerCalls.push(args);
    if ((args as { prompt?: string }).prompt === "fail") throw Object.assign(new Error("synthetic"), { status: 502 });
    return "synthetic answer";
  },
}));
vi.mock("repo-docs/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("repo-docs/server")>()),
  runDocumentationFlowWithProgress: async (shared: Record<string, unknown>) => {
    h.flowShared = shared;
    return { generatedChapters: [], generatedIndex: "", chapterFilenames: {} };
  },
}));
vi.mock("@/lib/output-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/output-utils")>()),
  docStore: { saveChapter: async () => "chapter.md", saveMeta: async () => undefined },
}));

import { baseUrlProblem, LlmGateError } from "@/backend/llm/gate";
import { POST as llmTest } from "@/app/api/llm-test/route";
import { POST as generateDocs } from "@/app/api/generate-docs/route";
import { guardedCallLLM, type LlmGuard } from "repo-docs/server";

const req = (url: string, body: unknown) => new NextRequest(`http://localhost:3000${url}`, { method: "POST", body: JSON.stringify(body) });
const testBody = { provider: "openai", model: "gpt-synthetic", apiKey: "sk-SYNTHETIC-not-logged-123" };
const docsBody = { repoUrl: "https://github.com/synthetic/repo", llmProvider: "openai", llmModel: "gpt-synthetic" };

beforeEach(() => {
  Object.assign(h, { role: "admin", reservation: { ok: true, callId: "call-1", remainingToday: 2 }, mutations: [], providerCalls: [], flowShared: null });
});
afterEach(() => vi.restoreAllMocks());

describe("baseUrlProblem", () => {
  it.each([undefined, null, "", "http://127.0.0.1:11434/v1", "http://localhost:11434", "https://[::1]:8443/v1"])("allows %j", (url) => {
    expect(baseUrlProblem(url)).toBeNull();
  });
  it.each([
    "https://api.openai.com/v1",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5:8080",
    "http://127.0.0.1.attacker.example/v1",
    "http://user:pw@localhost:11434",
    "file:///etc/passwd",
    "not a url",
  ])("refuses %j", (url) => {
    expect(baseUrlProblem(url)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("/api/llm-test", () => {
  it.each([
    ["signed out", null, 401],
    ["a non-admin", "user", 403],
  ])("%s: refused, no reservation, no provider call", async (_n, role, status) => {
    h.role = role;
    expect((await llmTest(req("/api/llm-test", testBody))).status).toBe(status);
    expect(h.mutations).toEqual([]);
    expect(h.providerCalls).toEqual([]);
  });

  it("a non-local base URL is refused before a unit is taken", async () => {
    expect((await llmTest(req("/api/llm-test", { ...testBody, baseUrl: "http://169.254.169.254/" }))).status).toBe(400);
    expect(h.mutations).toEqual([]);
    expect(h.providerCalls).toEqual([]);
  });

  it.each([
    [{ ok: false, code: "user_cap" }, 429],
    [{ ok: false, code: "global_cap" }, 429],
    [undefined, 503],
  ])("over a cap or unchecked (%j): no provider call", async (reservation, status) => {
    h.reservation = reservation;
    expect((await llmTest(req("/api/llm-test", testBody))).status).toBe(status);
    expect(h.providerCalls).toEqual([]);
  });

  it("an admin's test takes one unit, is logged, and nothing about keys reaches the console", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const res = await llmTest(req("/api/llm-test", testBody));
    expect(res.status).toBe(200);
    expect(h.providerCalls).toHaveLength(1);
    expect(h.mutations.map((m) => m.name)).toEqual([expect.stringMatching(/reserve/), expect.stringMatching(/finish/)]);
    const log = lines.join("\n");
    expect(log).not.toMatch(/API_KEY|OPENAI_KEY|length|sk-SYNTHETIC|Custom API Key/i);
  });
});

describe("/api/generate-docs", () => {
  it.each([
    ["signed out", null, 401],
    ["a non-admin", "user", 403],
  ])("%s: refused before the flow starts", async (_n, role, status) => {
    h.role = role;
    expect((await generateDocs(req("/api/generate-docs", docsBody))).status).toBe(status);
    expect(h.flowShared).toBeNull();
  });

  it("a non-local base URL is refused before the flow starts", async () => {
    expect((await generateDocs(req("/api/generate-docs", { ...docsBody, llmBaseUrl: "https://example.com/v1" }))).status).toBe(400);
    expect(h.flowShared).toBeNull();
  });

  it("an admin's flow gets a guard that reserves per model call and throws when refused", async () => {
    const res = await generateDocs(req("/api/generate-docs", docsBody));
    expect(res.status).toBe(200);
    await res.text(); // let the background flow run
    const guard = h.flowShared?._llmGuard as LlmGuard;
    expect(typeof guard).toBe("function");
    const done = await guard("openai", "gpt-synthetic");
    await done(true, 10);
    expect(h.mutations.filter((m) => /reserve/.test(m.name))).toHaveLength(1);
    h.reservation = { ok: false, code: "user_cap" };
    await expect(guard("openai", "gpt-synthetic")).rejects.toBeInstanceOf(LlmGateError);
  });
});

describe("guardedCallLLM (the docs flow's only way to a model)", () => {
  const options = { prompt: "SYNTHETIC-PROMPT", provider: "openai", model: "gpt-synthetic" };

  it("a refusing guard means no provider call", async () => {
    const guard: LlmGuard = async () => {
      throw new Error("refused");
    };
    await expect(guardedCallLLM(guard, options)).rejects.toThrow("refused");
    expect(h.providerCalls).toEqual([]);
  });

  it("logs the outcome, ok or not, and never hands the guard the prompt", async () => {
    const outcomes: unknown[][] = [];
    const seen: unknown[][] = [];
    const guard: LlmGuard = async (...args) => {
      seen.push(args);
      return async (...o) => void outcomes.push(o);
    };
    expect(await guardedCallLLM(guard, options)).toBe("synthetic answer");
    await expect(guardedCallLLM(guard, { ...options, prompt: "fail" })).rejects.toThrow("synthetic");
    expect(seen).toEqual([["openai", "gpt-synthetic"], ["openai", "gpt-synthetic"]]);
    expect(outcomes.map((o) => [o[0], o[2]])).toEqual([[true, undefined], [false, 502]]);
  });

  it("nodes.ts has no model call that skips the guard", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../packages/repo-docs/src/repoScrapper/nodes.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function guardedCallLLM"));
    const outside = src.replace(body.slice(0, body.indexOf("\n}\n") + 3), "");
    expect(outside.match(/\bcallLLM\(/g) ?? []).toEqual([]);
    expect(src.match(/guardedCallLLM\(this\._shared\?\._llmGuard/g)).toHaveLength(4);
  });
});
