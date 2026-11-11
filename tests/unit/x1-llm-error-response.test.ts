// X1: the engine's LLMError becomes the app's problem response in
// src/backend/llm/errors.ts. Pins the shape /api/llm sent before the move.
import { describe, expect, it } from "vitest";
import { createLLMErrorResponse, toLLMError } from "@/backend/llm/errors";
import { LLMError, LLM_ERROR_CODES } from "@/llm/errors";

const req = new Request("http://localhost:3000/api/llm", { method: "POST" });

describe("LLM error to app response", () => {
  it("a provider 429 becomes a 429 problem+json with the engine's code", async () => {
    const res = createLLMErrorResponse(toLLMError(Object.assign(new Error("slow down"), { status: 429 }), "openai", "m"), req);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatchObject({
      type: "error://llm/LLM_RATE_LIMITED",
      title: "Llm Rate Limited",
      status: 429,
      code: "LLM_RATE_LIMITED",
      instance: "http://localhost:3000/api/llm",
      provider: "openai",
    });
    expect(typeof body.error.hint).toBe("string");
    expect(typeof body.error.timestamp).toBe("string");
  });

  it("an unknown failure is a 502 provider error for provider 'unknown'", async () => {
    const res = createLLMErrorResponse(toLLMError(new Error("boom")), req);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "LLM_PROVIDER_ERROR", detail: "boom", provider: "unknown" });
  });

  it("an LLMError passes through unchanged", () => {
    const e = new LLMError(LLM_ERROR_CODES.LLM_TIMEOUT, "late");
    expect(toLLMError(e)).toBe(e);
  });
});
