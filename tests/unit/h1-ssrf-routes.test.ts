// H1: the analyzer and the link checker refuse internal hosts before any
// socket opens. The real guard runs here; the isolation guard in
// vitest-setup.ts would turn any attempted connection into a failure.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "user" as string | null }));
vi.mock("@/lib/auth-server", () => ({
  betterAuthRole: async () => h.role,
  routeDocOwner: async () => (h.role ? { writeKey: "account-1" } : null),
}));

import { POST as analyze } from "@/app/api/repo/analyze/route";
import { POST as validateUrl } from "@/app/api/validate-url/route";

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.role = "user";
  vi.stubGlobal("fetch", async () => {
    throw new Error("global fetch must not be used for user URLs");
  });
});

describe("/api/repo/analyze internal hosts", () => {
  it.each([
    "https://gitlab.internal/group/repo",
    "https://gitlab.localhost/group/repo",
    "https://gitlab@127.0.0.1/group/repo",
    "https://gitlab.example.com:8443/group/repo",
    "https://gitea.corp/owner/repo",
  ])("%s: 400, nothing fetched", async (url) => {
    const res = await analyze(post("/api/repo/analyze", { url }));
    expect(res.status).toBe(400);
  });

  it("admins get the same refusal", async () => {
    h.role = "admin";
    expect((await analyze(post("/api/repo/analyze", { url: "https://gitlab.internal/g/r" }))).status).toBe(400);
  });
});

describe("/api/validate-url internal hosts", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3240/version",
    "http://localhost:3000/",
    "http://[::1]/",
    "http://10.0.0.1/",
  ])("%s: reported unreachable without a request", async (url) => {
    const res = await validateUrl(post("/api/validate-url", { url }));
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/"reachable":false/);
    expect(JSON.stringify(json)).toMatch(/not reachable from this server|default http and https ports|not allowed/);
  });
});

describe("no plain fetch for visitor-influenced URLs", () => {
  // The ui-refresh merge conflicts in analyze/route.ts; taking the wrong side
  // would silently swap safeFetch back to fetch. Parsed with the TypeScript
  // compiler, so comments and strings can't hide or fake a call.
  const BANNED_MODULES = /^(axios|got|undici|node-fetch|cross-fetch|isomorphic-fetch|ky)(\/|$)/;

  function outboundCalls(source: string): string[] {
    const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === "fetch") found.push("fetch(");
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch") found.push(`${callee.getText()}(`);
        if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === "fetch") found.push(`${callee.getText()}(`);
        const arg = node.arguments[0];
        if ((ts.isIdentifier(callee) && callee.text === "require") || callee.kind === ts.SyntaxKind.ImportKeyword) {
          if (arg && ts.isStringLiteralLike(arg) && BANNED_MODULES.test(arg.text)) found.push(`import ${arg.text}`);
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && BANNED_MODULES.test(node.moduleSpecifier.text)) {
        found.push(`import ${node.moduleSpecifier.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
  }

  it("the checker catches the forms it must", () => {
    expect(outboundCalls("await fetch(u)")).toEqual(["fetch("]);
    expect(outboundCalls("await globalThis.fetch(u)")).toEqual(["globalThis.fetch("]);
    expect(outboundCalls('await window["fetch"](u)')).toEqual(['window["fetch"](']);
    expect(outboundCalls('const u = "https://x//y"; await fetch(u)')).toEqual(["fetch("]);
    expect(outboundCalls('import axios from "axios"; const g = require("got"); await import("undici")')).toEqual(["import axios", "import got", "import undici"]);
    expect(outboundCalls('// fetch(u)\n/* fetch(u) */ const s = "fetch(u)"; await safeFetch(u)')).toEqual([]);
  });

  it.each(["src/app/api/repo/analyze/route.ts", "src/app/api/validate-url/route.ts", "packages/repo-docs/src/repoScrapper/server-crawler.ts"])(
    "%s only uses safeFetch",
    (file) => {
      const src = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      expect(outboundCalls(src)).toEqual([]);
      expect(src).toMatch(/\bsafeFetch\(/);
    },
  );
});
