// X4 audit: a model server that echoes the key back in an error body (some
// providers quote part of it) must not get the key into any output. The flow's
// step retries wait 20s each; here pocketflow's wait is set to 0 so the run
// gives up quickly and prints the server's error as its final message.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/main";
import type { FetchRecord } from "./support/github-fixture";
import { startLlmStub, type LlmStub } from "./support/llm-stub";

const PKG = path.resolve(__dirname, "..");
const FAKE_KEY = "sk-x4-echoed-fake-key-0123456789abcdef";
const FAKE_TOKEN = "x4-echo-fake-github-token-0123456789";

const fetched = vi.hoisted(() => [] as FetchRecord[]);
vi.mock("../src/repoScrapper/net/safe-fetch", async (importOriginal) => {
  const { fixtureSafeFetch } = await vi.importActual<typeof import("./support/github-fixture")>("./support/github-fixture");
  return { ...(await importOriginal<object>()), safeFetch: fixtureSafeFetch(fetched) };
});
vi.mock("pocketflow", async (importOriginal) => {
  const pf = await importOriginal<typeof import("pocketflow")>();
  type Ctor = new (maxRetries?: number, wait?: number) => object;
  class Node extends (pf.Node as unknown as Ctor) {
    constructor(maxRetries?: number) {
      super(maxRetries, 0);
    }
  }
  class BatchNode extends (pf.BatchNode as unknown as Ctor) {
    constructor(maxRetries?: number) {
      super(maxRetries, 0);
    }
  }
  return { ...pf, Node, BatchNode };
});

let dir: string;
let stub: LlmStub;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-docs-x4-echo-"))));
afterEach(async () => {
  await stub?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run(extra: string[]) {
  const envFile = path.join(dir, "test.env");
  fs.writeFileSync(envFile, `OPENAI_API_KEY=${FAKE_KEY}\nGITHUB_TOKEN=${FAKE_TOKEN}\n`);
  let stdout = "";
  let stderr = "";
  const code = await main(
    ["generate", "acme/tiny", "--env-file", envFile, "--base-url", stub.baseUrl, "--allow-loopback-llm", "--out", path.join(dir, "out"), ...extra],
    { stdout: { write: (s: string) => (stdout += s) }, stderr: { write: (s: string) => (stderr += s) }, cwd: dir, env: {}, packageDir: PKG },
  );
  return { code, all: stdout + stderr, stdout };
}

describe("a key echoed back by the model server", () => {
  // 500: the engine keeps only a generic message. 418: an error it doesn't
  // recognize keeps the provider's text on `cause`, which --verbose prints.
  it.each([
    [500, ["--verbose"], false],
    [500, ["--json", "--verbose"], false],
    [418, ["--verbose"], true],
    [418, ["--json", "--verbose"], true],
  ])("HTTP %i %j: never reaches the output, and each try is one request", async (status, extra, echoPrinted) => {
    stub = await startLlmStub({ status, echo: FAKE_KEY });
    const { code, all } = await run(extra);
    expect(code).toBe(1);
    // The flow tries the first step 5 times; with the SDK's retries off that is 5 requests.
    expect(stub.requests).toHaveLength(5);
    if (echoPrinted) expect(all).toContain("stub refusal for [redacted]");
    for (const secret of [FAKE_KEY, FAKE_TOKEN, encodeURIComponent(FAKE_KEY)]) expect(all).not.toContain(secret);
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
  });
});
