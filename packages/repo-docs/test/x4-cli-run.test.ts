// X4: whole CLI runs, in-process. The model is the loopback stub
// (support/llm-stub.ts) and the GitHub crawl is a fixture: the engine's safe
// fetch is replaced by one that serves a two-file repository and records what
// it was asked for. Nothing reaches GitHub or a real provider.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/main";
import { FileDocStore } from "../src/repoScrapper/store/file-doc-store";
import { startLlmStub, type LlmStub } from "./support/llm-stub";

const PKG = path.resolve(__dirname, "..");
const FAKE_KEY = "sk-x4-fake-openai-key-0123456789abcdef";
const FAKE_TOKEN = "x4-fake-github-token-0123456789abcdef";

const fetched = vi.hoisted(() => [] as { url: string; authorization?: string }[]);

vi.mock("../src/repoScrapper/net/safe-fetch", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/repoScrapper/net/safe-fetch")>();
  const FILES: Record<string, { path: string; text: string }> = {
    sha0: { path: "src/greet.ts", text: "export const greet = (n: string) => `hi ${n}`;\n" },
    sha1: { path: "src/main.ts", text: "import { greet } from './greet';\nconsole.log(greet('x'));\n" },
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return {
    ...original,
    safeFetch: async (input: string | URL, init: { headers?: Record<string, string> } = {}) => {
      const url = String(input);
      fetched.push({ url, authorization: init.headers?.Authorization });
      if (url === "https://api.github.com/repos/acme/tiny") return json({ default_branch: "main" });
      if (url === "https://api.github.com/repos/acme/tiny/git/trees/main?recursive=1") {
        return json({
          sha: "t",
          url,
          truncated: false,
          tree: Object.entries(FILES).map(([sha, f]) => ({ path: f.path, mode: "100644", type: "blob", sha, size: f.text.length })),
        });
      }
      const blob = url.match(/\/git\/blobs\/(\w+)$/)?.[1];
      if (blob && FILES[blob]) return json({ sha: blob, size: FILES[blob].text.length, encoding: "base64", content: Buffer.from(FILES[blob].text).toString("base64") });
      return new Response("not found", { status: 404 });
    },
  };
});

let dir: string;
let stub: LlmStub;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-docs-x4-"));
  fetched.length = 0;
});
afterEach(async () => {
  await stub?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeEnv(lines: string[]): string {
  const file = path.join(dir, "test.env");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

async function run(args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
    cwd: dir,
    env: {},
    packageDir: PKG,
  });
  return { code, stdout, stderr };
}

const baseArgs = (envFile: string, extra: string[] = []) => [
  "generate",
  "https://github.com/acme/tiny",
  "--env-file",
  envFile,
  "--base-url",
  stub.baseUrl,
  "--allow-loopback-llm",
  ...extra,
];

describe("repo-docs generate, end to end", () => {
  it("writes the FileDocStore layout, sends the key only to the model server and the token only to GitHub, and prints neither", async () => {
    stub = await startLlmStub();
    const envFile = writeEnv([`OPENAI_API_KEY=${FAKE_KEY}`, `GITHUB_TOKEN=${FAKE_TOKEN}`]);
    const out = path.join(dir, "docs", "acme-tiny");

    const { code, stdout, stderr } = await run(baseArgs(envFile, ["--out", out, "--verbose", "--max-chapters", "2"]));
    expect(stderr).not.toMatch(/repo-docs: /);
    expect(code).toBe(0);

    // The layout FileDocStore writes and reads: NN_title.md chapters, -1_overview.md, _meta.json.
    const names = fs.readdirSync(out).sort();
    expect(names).toEqual(["-1_overview.md", "00_chapter-1-entry-point.md", "01_chapter-2-greeter.md", "_meta.json"]);
    for (const name of names.filter((n) => n.endsWith(".md"))) {
      expect(fs.readFileSync(path.join(out, name), "utf8")).toMatch(/^---\ntitle: ".+"\norder: -?\d+\ngeneratedAt: "/);
    }
    const store = new FileDocStore(path.dirname(out));
    const meta = await store.readMeta("acme-tiny");
    expect(meta).toMatchObject({
      projectSlug: "acme-tiny",
      repoUrl: "https://github.com/acme/tiny",
      repoOwner: "acme",
      repoName: "tiny",
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      chapters: [
        { filename: "00_chapter-1-entry-point.md", title: "Chapter 1: Entry Point", order: 0 },
        { filename: "01_chapter-2-greeter.md", title: "Chapter 2: Greeter", order: 1 },
      ],
    });
    expect(await store.readChapter("acme-tiny", "01_chapter-2-greeter.md")).toContain("This chapter explains");
    expect(fs.readdirSync(dir).sort()).toEqual(["docs", "test.env"]);

    // 3 planning calls + 2 chapters, each carrying the key, all to the stub.
    expect(stub.requests.map((r) => r.kind)).toEqual(["abstractions", "relationships", "order", "chapter", "chapter"]);
    expect(stub.requests.every((r) => r.authorization === `Bearer ${FAKE_KEY}` && r.path === "/v1/chat/completions")).toBe(true);
    // The crawl went to api.github.com only, with the token.
    expect(fetched.length).toBe(4);
    expect(fetched.every((f) => f.url.startsWith("https://api.github.com/repos/acme/tiny") && f.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);

    expect(stdout).toContain("Done: 4 files");
    expect(stderr).toContain("[Server Crawler]"); // --verbose passes the engine's lines through
    for (const secret of [FAKE_KEY, FAKE_TOKEN, encodeURIComponent(FAKE_KEY)]) {
      expect(stdout).not.toContain(secret);
      expect(stderr).not.toContain(secret);
    }
  });

  it("--json prints one JSON object per line on stdout and keeps the engine's lines off it", async () => {
    stub = await startLlmStub();
    const envFile = writeEnv([`OPENAI_API_KEY=${FAKE_KEY}`]);
    const { code, stdout, stderr } = await run(baseArgs(envFile, ["--json", "--max-chapters", "2"]));
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const events = stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(events[0]).toMatchObject({ type: "start", provider: "openai", maxLlmCalls: 40 });
    expect(events.filter((e) => e.type === "llm-call")).toHaveLength(5);
    expect(events.some((e) => e.type === "progress" && e.stage === "abstractions")).toBe(true);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", llmCalls: 5 });
    expect(done.out).toMatch(new RegExp(`docs-output${path.sep === "\\" ? "\\\\" : "/"}acme-tiny-\\d{8}-[a-z0-9]+$`));
    expect(fs.existsSync(path.join(done.out, "_meta.json"))).toBe(true);
    expect(stdout).not.toContain(FAKE_KEY);
  });

  it("stops at --max-llm-calls without another model call and writes nothing", async () => {
    stub = await startLlmStub();
    const envFile = writeEnv([`OPENAI_API_KEY=${FAKE_KEY}`]);
    const out = path.join(dir, "capped");
    const started = Date.now();
    const { code, stderr } = await run(baseArgs(envFile, ["--out", out, "--max-llm-calls", "2", "--max-chapters", "2"]));
    expect(code).toBe(1);
    expect(stderr).toContain("reached its cap of 2 model calls");
    expect(stub.requests).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(10_000); // the flow's 20s retry wait is not waited out
    expect(fs.existsSync(out)).toBe(false);
  });

  it("stops after the first refused key instead of retrying", async () => {
    stub = await startLlmStub({ status: 401 });
    const envFile = writeEnv([`OPENAI_API_KEY=${FAKE_KEY}`]);
    const { code, stderr } = await run(baseArgs(envFile, ["--out", path.join(dir, "refused")]));
    expect(code).toBe(1);
    expect(stderr).toContain("refused the key (HTTP 401)");
    expect(stub.requests.length).toBeLessThanOrEqual(2); // the SDK may retry once; the flow does not
    expect(stderr).not.toContain(FAKE_KEY);
  });
});
