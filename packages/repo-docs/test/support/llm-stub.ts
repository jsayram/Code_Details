// X4: a throwaway OpenAI-compatible model server on 127.0.0.1 for CLI tests.
// It answers /v1/chat/completions with canned replies picked by which of the
// engine's four prompts it got, and records each request (path, the bearer
// key it carried, the prompt kind). Nothing here reaches a real provider.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { allowTestOwnedPort } from "./loopback-port";

export type PromptKind = "abstractions" | "relationships" | "order" | "chapter";

export interface StubRequest {
  path: string;
  authorization: string | undefined;
  kind: PromptKind;
}

export interface LlmStub {
  baseUrl: string;
  requests: StubRequest[];
  close(): Promise<void>;
}

function kindOf(prompt: string): PromptKind {
  if (prompt.includes("best order to explain")) return "order";
  if (prompt.includes("from_abstraction")) return "relationships";
  if (prompt.includes("file_indices")) return "abstractions";
  return "chapter";
}

const REPLIES: Record<PromptKind, (n: number) => string> = {
  abstractions: () =>
    [
      "```yaml",
      "- name: Greeter",
      "  description: Says hello to whoever calls it.",
      "  file_indices:",
      "    - 0 # src/greet.ts",
      "- name: Entry Point",
      "  description: Starts the program and calls the greeter.",
      "  file_indices:",
      "    - 1 # src/main.ts",
      "```",
    ].join("\n"),
  relationships: () =>
    [
      "```yaml",
      "summary: A tiny program that prints a greeting.",
      "relationships:",
      "  - from_abstraction: 1 # Entry Point",
      "    to_abstraction: 0 # Greeter",
      "    label: Calls",
      "```",
    ].join("\n"),
  order: () => ["```yaml", "- 1 # Entry Point", "- 0 # Greeter", "```"].join("\n"),
  chapter: (n) => `# Chapter ${n}\n\nThis chapter explains one part of the stub project.\n`,
};

/** Starts the stub. `status` makes every reply that HTTP error instead; `echo` goes into its message. */
export async function startLlmStub(opts: { status?: number; echo?: string } = {}): Promise<LlmStub> {
  const requests: StubRequest[] = [];
  let chapters = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let prompt = "";
      try {
        prompt = JSON.parse(body).messages?.[0]?.content ?? "";
      } catch {
        /* an empty prompt counts as a chapter */
      }
      const kind = kindOf(prompt);
      requests.push({ path: req.url ?? "", authorization: req.headers.authorization, kind });
      res.setHeader("content-type", "application/json");
      if (opts.status) {
        res.statusCode = opts.status;
        res.end(JSON.stringify({ error: { message: `stub refusal${opts.echo ? ` for ${opts.echo}` : ""}`, ...(opts.status === 401 ? { type: "invalid_request_error", code: "invalid_api_key" } : { type: "server_error", code: null }) } }));
        return;
      }
      const content = REPLIES[kind](kind === "chapter" ? ++chapters : 0);
      res.end(
        JSON.stringify({
          id: `stub-${requests.length}`,
          object: "chat.completion",
          created: 0,
          model: "stub-model",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const release = allowTestOwnedPort(port);
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: async () => {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
