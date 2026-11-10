// H1 LLM hardening: the custom base URL allowlist and the docs flow failing
// closed without a gate. No real provider: @/llm/client is a double.
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
vi.mock("@/llm/client", () => ({
  callLLM: async (args: unknown) => {
    calls.push(args);
    return "synthetic answer";
  },
}));

import { baseUrlProblem } from "@/backend/llm/gate";
import { guardedCallLLM } from "@/repoScrapper/nodes";

afterEach(() => vi.unstubAllEnvs());

describe("baseUrlProblem in production", () => {
  it("refuses this machine's loopback unless the origin is listed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODEDETAILS_LLM_BASE_URL_ALLOWLIST", "");
    expect(baseUrlProblem("http://127.0.0.1:11434/v1")).toMatchObject({ ok: false, status: 400 });
    expect(baseUrlProblem("http://localhost:11434")).toMatchObject({ ok: false, status: 400 });
    expect(baseUrlProblem(undefined)).toBeNull();
  });

  it("allows exactly the listed origins", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODEDETAILS_LLM_BASE_URL_ALLOWLIST", " https://models.example.test , not a url,http://127.0.0.1:11434");
    expect(baseUrlProblem("https://models.example.test/v1")).toBeNull();
    expect(baseUrlProblem("http://127.0.0.1:11434/v1")).toBeNull();
    expect(baseUrlProblem("http://127.0.0.1:8080/v1")).toMatchObject({ status: 400 });
    expect(baseUrlProblem("https://models.example.test.evil.example/v1")).toMatchObject({ status: 400 });
    expect(baseUrlProblem("http://models.example.test/v1")).toMatchObject({ status: 400 });
    expect(baseUrlProblem("https://user:pw@models.example.test/v1")).toMatchObject({ status: 400 });
  });
});

describe("baseUrlProblem outside production", () => {
  it("keeps loopback for a local model server and refuses other hosts", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_LLM_BASE_URL_ALLOWLIST", "");
    expect(baseUrlProblem("http://127.0.0.1:11434/v1")).toBeNull();
    expect(baseUrlProblem("http://169.254.169.254/latest")).toMatchObject({ status: 400 });
  });
});

describe("guardedCallLLM without a guard", () => {
  it("refuses and never reaches the provider", async () => {
    calls.length = 0;
    await expect(guardedCallLLM(undefined, { prompt: "p", provider: "openai", model: "m" })).rejects.toThrow(/usage gate/);
    expect(calls).toEqual([]);
  });
});
