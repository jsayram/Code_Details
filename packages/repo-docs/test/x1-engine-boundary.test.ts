// X1, moved into the package in X3: the scraper engine must run without Code
// Details. No file in the package (source or tests) may import next/*,
// convex/*, any `@/` path (that alias is the app's), or a relative path that
// leaves the package. The client-safe entries must not reach the disk, DNS,
// sockets, a provider SDK or the server modules. Parsed with the TypeScript
// compiler, so comments and strings can't hide or fake an import.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PKG = path.resolve(__dirname, "..");
const SCANNED = ["src", "test", "bin"];

function specifiers(source: string, fileName = "x.ts"): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) {
      found.push(node.moduleReference.expression.text);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      const isLoader = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require");
      if (isLoader && arg && ts.isStringLiteralLike(arg)) found.push(arg.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Why a specifier crosses the boundary, or null when it's fine. */
function violation(spec: string, fromFile: string): string | null {
  if (/^next(\/|$)/.test(spec)) return "next";
  if (/^convex(\/|$)/.test(spec)) return "convex";
  if (spec.startsWith("@/")) return "app alias";
  if (/^(code-details|codedetailsweb)(\/|$)/.test(spec)) return "app package";
  if (spec.startsWith(".")) {
    const target = path.relative(PKG, path.resolve(path.dirname(fromFile), spec));
    return target.startsWith("..") || path.isAbsolute(target) ? "leaves the package" : null;
  }
  return null;
}

function packageFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
    }
  };
  for (const d of SCANNED) walk(path.join(PKG, d));
  return out;
}

function crossings(file: string, source = fs.readFileSync(file, "utf8")): string[] {
  return specifiers(source, file)
    .map((s) => [s, violation(s, file)] as const)
    .filter(([, why]) => why)
    .map(([s, why]) => `${path.relative(PKG, file)}: ${s} (${why})`);
}

function resolveRelative(fromFile: string, spec: string): string {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`can't resolve ${spec} from ${fromFile}`);
}

/** Every module a file reaches, following relative imports (type-only ones too). */
function reach(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiers(fs.readFileSync(file, "utf8"), file)) {
      if (spec.startsWith(".")) queue.push(resolveRelative(file, spec));
      else external.add(spec);
    }
  }
  return { files, external };
}

type ExportTarget = string | null | { [condition: string]: ExportTarget };
const manifest = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")) as {
  exports: Record<string, ExportTarget>;
  dependencies?: Record<string, string>;
  bin?: Record<string, string>;
};

const CLIENT_ENTRIES = [".", "./llm", "./store"];
const SERVER_ENTRIES = ["./server", "./llm/server", "./safe-fetch", "./store/file"];
// What a browser bundle must never get from the engine.
const SERVER_ONLY_MODULES = ["server-crawler.ts", "safe-fetch.ts", "file-doc-store.ts", "nodes.ts", "flow.ts", path.join("llm", "client.ts"), path.join("cli", "main.ts")];

describe("scraper engine import boundary", () => {
  const inEngine = path.join(PKG, "src/repoScrapper/x.ts");

  it("the checker catches the forms it must", () => {
    const bad = [
      'import { NextResponse } from "next/server";',
      'import type { X } from "next";',
      'export { y } from "convex/server";',
      'const a = await import("convex/values");',
      'const b = require("@/lib/auth-server");',
      'import { ErrorCode } from "@/constants/error-codes";',
      'type T = import("@/backend/llm/gate").GateRefusal;',
      'import x from "../../../../src/backend/llm/gate";',
      'import y = require("next/headers");',
      'import { callLLM } from "@/llm/client";',
      'import z from "code-details/src/lib/utils";',
    ].join("\n");
    expect(crossings(inEngine, bad)).toHaveLength(11);
  });

  it("the checker allows the engine's own and outside packages", () => {
    const ok = [
      'import { safeFetch } from "./net/safe-fetch";',
      'import { LLMError } from "../llm/errors";',
      'import { Flow } from "pocketflow";',
      'import dns from "node:dns";',
      '// import x from "next/server"',
      'const s = "import(\\"convex/server\\")";',
      'import { nextThing } from "nextish";',
    ].join("\n");
    expect(crossings(inEngine, ok)).toEqual([]);
  });

  it("finds package files to check", () => {
    const files = packageFiles();
    expect(files.some((f) => f.endsWith(path.join("repoScrapper", "server-crawler.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("llm", "errors.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("test", "x1-engine-boundary.test.ts")))).toBe(true);
  });

  it("no package file imports next/*, convex/* or app code", () => {
    expect(packageFiles().flatMap((f) => crossings(f))).toEqual([]);
  });
});

describe("package entries", () => {
  it("lists exactly the client and server entries", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual([...CLIENT_ENTRIES, ...SERVER_ENTRIES, "./package.json"].sort());
  });

  it("the CLI (X4) is only a bin, never an import entry", () => {
    expect(manifest.bin).toEqual({ "repo-docs": "bin/repo-docs.mjs" });
    expect(JSON.stringify(manifest.exports)).not.toMatch(/cli|bin\//);
  });

  it.each(SERVER_ENTRIES)("%s is closed to browser bundles", (entry) => {
    const target = manifest.exports[entry] as Record<string, ExportTarget>;
    expect(Object.keys(target)[0]).toBe("browser");
    expect(target.browser).toBeNull();
  });

  it.each(CLIENT_ENTRIES)("%s reaches no disk, DNS, socket, provider SDK or server module", (entry) => {
    const { files, external } = reach(path.join(PKG, manifest.exports[entry] as string));
    expect([...external].filter((s) => /^node:|^(fs|path|dns|net|http|https|tls|child_process)$/.test(s))).toEqual([]);
    expect([...external].filter((s) => Object.hasOwn(manifest.dependencies ?? {}, s))).toEqual([]);
    expect([...files].filter((f) => SERVER_ONLY_MODULES.some((m) => f.endsWith(path.sep + m)))).toEqual([]);
  });

  it("the reach check would see the server crawler behind the server entry", () => {
    const { files, external } = reach(path.join(PKG, (manifest.exports["./server"] as Record<string, string>).default));
    expect([...files].some((f) => f.endsWith("server-crawler.ts"))).toBe(true);
    expect(external.has("node:dns")).toBe(true);
  });
});
