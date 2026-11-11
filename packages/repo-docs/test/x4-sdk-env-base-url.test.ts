// X4 audit: the provider SDKs read OPENAI_BASE_URL, ANTHROPIC_BASE_URL and
// ANTHROPIC_AUTH_TOKEN from the environment when the client isn't given its
// own. callLLM must always pass an explicit base URL, so a variable left in the
// shell can't redirect a key and a repository's code to an unchecked host.
// The "redirect" target here is a loopback stub that must receive nothing; the
// real default hosts are refused by the test socket guard, so no request leaves.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callLLM } from "../src/llm/client";
import { startLlmStub, type LlmStub } from "./support/llm-stub";

const VARS = ["OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"] as const;
let trap: LlmStub;
let used: LlmStub;

beforeEach(async () => {
  trap = await startLlmStub();
  used = await startLlmStub();
  process.env.OPENAI_BASE_URL = trap.baseUrl;
  process.env.ANTHROPIC_BASE_URL = trap.baseUrl.replace(/\/v1$/, "");
  process.env.ANTHROPIC_AUTH_TOKEN = "x4-env-auth-token-0123456789";
});
afterEach(async () => {
  for (const v of VARS) delete process.env[v];
  await trap.close();
  await used.close();
});

describe("callLLM ignores the SDKs' base-URL variables", () => {
  it("openai with no custom base URL goes to its own endpoint, not OPENAI_BASE_URL", async () => {
    await expect(callLLM({ prompt: "p", provider: "openai", model: "gpt-4o-mini", customApiKey: "sk-x4-env-test-1", sdkMaxRetries: 0 })).rejects.toThrow();
    expect(trap.requests).toEqual([]);
  });

  it("anthropic goes to its own endpoint, not ANTHROPIC_BASE_URL", async () => {
    await expect(callLLM({ prompt: "p", provider: "anthropic", model: "claude-3-5-haiku-latest", customApiKey: "sk-x4-env-test-2", sdkMaxRetries: 0 })).rejects.toThrow();
    expect(trap.requests).toEqual([]);
  });

  it("a checked custom base URL still wins, and the environment's gets nothing", async () => {
    const reply = await callLLM({ prompt: "p", provider: "openai", model: "gpt-4o-mini", customApiKey: "sk-x4-env-test-3", customBaseUrl: used.baseUrl, sdkMaxRetries: 0 });
    expect(reply).toContain("Chapter 1");
    expect(used.requests).toHaveLength(1);
    expect(trap.requests).toEqual([]);
  });

  it("sdkMaxRetries: 0 makes exactly one HTTP request on a server error", async () => {
    await used.close();
    used = await startLlmStub({ status: 500 });
    await expect(callLLM({ prompt: "p", provider: "openai", model: "gpt-4o-mini", customApiKey: "sk-x4-env-test-4", customBaseUrl: used.baseUrl, sdkMaxRetries: 0 })).rejects.toThrow();
    expect(used.requests).toHaveLength(1);
  });
});
