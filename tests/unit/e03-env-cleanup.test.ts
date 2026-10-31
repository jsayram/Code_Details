// E03 slice 4: the Supabase-era env names and the second e2e read mode are
// gone. validateEnv requires no Supabase, DATABASE_URL or Algolia name; the
// isolated env hands out no Supabase name; the app server and the isolated
// build get no database URL (the runner still uses the test DB for fixtures);
// no browser spec reads CODEDETAILS_E2E_READ_BACKEND. The isolation guard
// still refuses those names when they point at a development port.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isolatedEnv, isolationProblems } from "../support/isolation";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/^\s*\/\/.*$/gm, "");
const REMOVED = /SUPABASE|DATABASE_URL|ALGOLIA/;

describe("Supabase-era env names", () => {
  it("validateEnv requires no Supabase, DATABASE_URL or Algolia name", () => {
    const required = code("scripts/validateEnv.ts").match(/const requiredEnvVars[^=]*=\s*\[([^\]]*)\]/)![1];
    expect(required).not.toMatch(REMOVED);
  });

  it("the isolated env sets no Supabase name", () => {
    expect(Object.keys(isolatedEnv()).filter((n) => /SUPABASE/.test(n))).toEqual([]);
  });

  it("the app server and the isolated build get no DATABASE_URL", () => {
    const config = code("playwright.config.ts");
    const serverEnv = config.slice(config.indexOf("const serverEnv = isolatedEnv("), config.indexOf(");", config.indexOf("const serverEnv = isolatedEnv(")));
    expect(serverEnv).toMatch(/\bundefined,/);
    expect(serverEnv).not.toMatch(/\bpassword\b/);
    expect(code("tests/ci/isolated-build.mjs")).not.toMatch(/no-such-database|SYNTHETIC/);
  });

  it("the guard still refuses a removed name pointing at a development port", () => {
    expect(isolationProblems({ ...isolatedEnv(), NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).join()).toMatch(/development port 54321/);
  });
});

describe("one browser read mode", () => {
  it("no spec or e2e helper reads CODEDETAILS_E2E_READ_BACKEND", () => {
    const files = execSync("git ls-files --cached --others --exclude-standard -- tests/e2e", { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|mjs)$/.test(f));
    expect(files.filter((f) => code(f).includes("CODEDETAILS_E2E_READ_BACKEND"))).toEqual([]);
  });

  it("the Playwright config refuses any other read mode", () => {
    expect(code("playwright.config.ts")).toMatch(/CODEDETAILS_E2E_READ_BACKEND \?\? "convex"\) !== "convex"\) \{\n\s*throw/);
  });
});
