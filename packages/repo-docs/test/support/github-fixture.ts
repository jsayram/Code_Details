// X4: a stand-in for the engine's safe fetch in CLI tests. It serves a
// two-file repository, acme/tiny, from memory and records each URL with the
// Authorization header it carried. Used through vi.mock of the safe-fetch
// module, so no test reaches GitHub.
export interface FetchRecord {
  url: string;
  authorization?: string;
}

const FILES: Record<string, { path: string; text: string }> = {
  sha0: { path: "src/greet.ts", text: "export const greet = (n: string) => `hi ${n}`;\n" },
  sha1: { path: "src/main.ts", text: "import { greet } from './greet';\nconsole.log(greet('x'));\n" },
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

export function fixtureSafeFetch(fetched: FetchRecord[]) {
  return async (input: string | URL, init: { headers?: Record<string, string> } = {}): Promise<Response> => {
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
    if (blob && FILES[blob]) {
      return json({ sha: blob, size: FILES[blob].text.length, encoding: "base64", content: Buffer.from(FILES[blob].text).toString("base64") });
    }
    return new Response("not found", { status: 404 });
  };
}
