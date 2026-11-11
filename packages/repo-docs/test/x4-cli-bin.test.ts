// X4: the real `repo-docs` command (bin/repo-docs.mjs) in a child process, with
// an empty environment and a settings file the test writes. Every case here
// ends before the network: a run that would crawl lives in x4-cli-run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = path.resolve(__dirname, "../bin/repo-docs.mjs");
const FAKE_KEY = "sk-x4-bin-fake-key-abcdef0123456789";
const FAKE_TOKEN = "x4-bin-fake-github-token-0123456789";

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-docs-x4-bin-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function cli(args: string[], envLines: string[] = []) {
  const envFile = path.join(dir, "test.env");
  fs.writeFileSync(envFile, envLines.join("\n") + "\n");
  const r = spawnSync(process.execPath, [BIN, ...args, "--env-file", envFile], { cwd: dir, env: {}, encoding: "utf8", timeout: 20_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("repo-docs bin", () => {
  it("--help prints the usage and exits 0", () => {
    const r = cli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Usage: repo-docs generate <github-url>/);
    expect(r.stderr).toBe("");
  });

  it("bad arguments exit 2 with the reason on stderr", () => {
    const r = cli(["generate", "acme/tiny", "--max-llm-calls", "0"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--max-llm-calls must be a whole number from 1 to 500");
    expect(r.stdout).toBe("");
  });

  it("a missing key exits 2 and names the setting", () => {
    const r = cli(["generate", "acme/tiny"], ["GITHUB_TOKEN=" + FAKE_TOKEN]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Missing setting OPENAI_API_KEY");
    expect(r.stderr + r.stdout).not.toContain(FAKE_TOKEN);
  });

  it("refuses a base URL off the allowlist, and loopback without the flag, without printing the key", () => {
    const keys = [`OPENAI_API_KEY=${FAKE_KEY}`, `GITHUB_TOKEN=${FAKE_TOKEN}`];
    const off = cli(["generate", "acme/tiny", "--base-url", "https://evil.example.com/v1", "--verbose"], keys);
    expect(off.code).toBe(2);
    expect(off.stderr).toContain("not on REPO_DOCS_LLM_BASE_URL_ALLOWLIST");
    const loop = cli(["generate", "acme/tiny", "--base-url", "http://127.0.0.1:9/v1", "--verbose"], keys);
    expect(loop.code).toBe(2);
    expect(loop.stderr).toContain("needs --allow-loopback-llm");
    for (const r of [off, loop]) {
      expect(r.stdout + r.stderr).not.toContain(FAKE_KEY);
      expect(r.stdout + r.stderr).not.toContain(FAKE_TOKEN);
    }
    expect(fs.readdirSync(dir)).toEqual(["test.env"]);
  });

  it("--json reports a refusal as one JSON line on stdout", () => {
    const r = cli(["generate", "acme/tiny", "--json", "--base-url", "https://evil.example.com"], [`OPENAI_API_KEY=${FAKE_KEY}`]);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({ type: "error", exitCode: 2, message: "The base URL is not on REPO_DOCS_LLM_BASE_URL_ALLOWLIST" });
  });
});
