// H1 (moved from the app's h1-llm-base-url test in X3): the docs flow fails
// closed without a usage gate. No real provider: the LLM client is a double.
import { describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
vi.mock("../src/llm/client", () => ({
  callLLM: async (args: unknown) => {
    calls.push(args);
    return "synthetic answer";
  },
}));

import { guardedCallLLM } from "../src/repoScrapper/nodes";

describe("guardedCallLLM without a guard", () => {
  it("refuses and never reaches the provider", async () => {
    calls.length = 0;
    await expect(guardedCallLLM(undefined, { prompt: "p", provider: "openai", model: "m" })).rejects.toThrow(/usage gate/);
    expect(calls).toEqual([]);
  });
});
