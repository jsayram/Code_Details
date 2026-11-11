// X3: the app reaches the scraper engine only through the `repo-docs`
// package's entries. The package checks its own side
// (packages/repo-docs/test/x1-engine-boundary.test.ts).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SERVER_ENTRIES = /^repo-docs\/(server|llm\/server|safe-fetch|store\/file)$/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "output" ? [] : sourceFiles(full);
    return /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name) ? [full] : [];
  });
}

function specifiers(file: string): { specs: string[]; client: boolean } {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      const loader = node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require");
      if (loader && arg && ts.isStringLiteralLike(arg)) specs.push(arg.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) specs.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const first = sf.statements[0];
  const client = !!first && ts.isExpressionStatement(first) && ts.isStringLiteralLike(first.expression) && first.expression.text === "use client";
  return { specs, client };
}

const appFiles = sourceFiles(path.join(ROOT, "src"));

describe("app imports of the engine package", () => {
  it("the old engine folders are gone", () => {
    expect(fs.existsSync(path.join(ROOT, "src/repoScrapper"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "src/llm"))).toBe(false);
  });

  it("no app file reaches into the package's files or the old aliases", () => {
    const bad = appFiles.flatMap((f) =>
      specifiers(f).specs
        .filter((s) => /^repo-docs\/src(\/|$)|packages\/repo-docs|^@\/(repoScrapper|llm)(\/|$)/.test(s))
        .map((s) => `${path.relative(ROOT, f)}: ${s}`),
    );
    expect(bad).toEqual([]);
  });

  it("no client component imports a server entry", () => {
    const bad = appFiles.flatMap((f) => {
      const { specs, client } = specifiers(f);
      return client ? specs.filter((s) => SERVER_ENTRIES.test(s)).map((s) => `${path.relative(ROOT, f)}: ${s}`) : [];
    });
    expect(bad).toEqual([]);
  });

  it("the app does import the package (the checks above see real imports)", () => {
    const all = appFiles.flatMap((f) => specifiers(f).specs);
    expect(all).toContain("repo-docs");
    expect(all).toContain("repo-docs/server");
  });

  // docs-output-root is imported widely by the app; it must not pull node:fs in
  // (moved here from x2-file-doc-store in X3).
  it("src/lib/docs-output-root.ts imports neither fs nor the file store", () => {
    const specs = specifiers(path.join(ROOT, "src/lib/docs-output-root.ts")).specs;
    expect(specs.filter((s) => /^(node:)?fs(\/|$)|file-doc-store|^repo-docs\/store\/file$/.test(s))).toEqual([]);
  });
});
