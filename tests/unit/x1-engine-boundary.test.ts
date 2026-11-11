// X1: the scraper engine (src/repoScrapper, src/llm) must run without Code
// Details. No file in it may import next/*, convex/*, an @/ path outside the
// two engine folders, or a relative path that leaves them. Parsed with the
// TypeScript compiler, so comments and strings can't hide or fake an import.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const ENGINE_DIRS = ["src/repoScrapper", "src/llm"];
const ENGINE_ALIASES = /^@\/(repoScrapper|llm)(\/|$)/;

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
  if (spec.startsWith("@/")) return ENGINE_ALIASES.test(spec) ? null : "app alias";
  if (spec.startsWith(".")) {
    const target = path.relative(ROOT, path.resolve(path.dirname(fromFile), spec));
    return ENGINE_DIRS.some((d) => target === d || target.startsWith(`${d}${path.sep}`)) ? null : "leaves the engine";
  }
  return null;
}

function engineFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
    }
  };
  for (const d of ENGINE_DIRS) walk(path.join(ROOT, d));
  return out;
}

function crossings(file: string, source = fs.readFileSync(file, "utf8")): string[] {
  return specifiers(source, file)
    .map((s) => [s, violation(s, file)] as const)
    .filter(([, why]) => why)
    .map(([s, why]) => `${path.relative(ROOT, file)}: ${s} (${why})`);
}

describe("scraper engine import boundary", () => {
  const inEngine = path.join(ROOT, "src/repoScrapper/x.ts");

  it("the checker catches the forms it must", () => {
    const bad = [
      'import { NextResponse } from "next/server";',
      'import type { X } from "next";',
      'export { y } from "convex/server";',
      'const a = await import("convex/values");',
      'const b = require("@/lib/auth-server");',
      'import { ErrorCode } from "@/constants/error-codes";',
      'type T = import("@/backend/llm/gate").GateRefusal;',
      'import x from "../backend/llm/gate";',
      'import y = require("next/headers");',
    ].join("\n");
    expect(crossings(inEngine, bad)).toHaveLength(9);
  });

  it("the checker allows the engine's own and outside packages", () => {
    const ok = [
      'import { callLLM } from "@/llm/client";',
      'import type { P } from "@/repoScrapper";',
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

  it("finds engine files to check", () => {
    const files = engineFiles();
    expect(files.some((f) => f.endsWith(path.join("repoScrapper", "server-crawler.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("llm", "errors.ts")))).toBe(true);
  });

  it("no engine file imports next/*, convex/* or app code", () => {
    expect(engineFiles().flatMap((f) => crossings(f))).toEqual([]);
  });
});
