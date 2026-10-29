// D11: the docs and generator routes take their user ID from routeUserId()
// (Clerk by default, the session's Clerk-era subject behind the switch), and
// each still refuses a missing ID before anything else uses it.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const ROUTES = [
  "src/app/api/docs/route.ts",
  "src/app/api/docs/[slug]/route.ts",
  "src/app/api/docs/[slug]/[filename]/route.ts",
  "src/app/api/docs/[slug]/link-project/route.ts",
  "src/app/api/generate-docs/route.ts",
  "src/app/api/llm/route.ts",
  "src/app/api/llm-test/route.ts",
  "src/app/api/repo/analyze/route.ts",
  "src/app/api/repo/crawl/route.ts",
];
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("D11 route identity", () => {
  it.each(ROUTES)("%s doesn't import Clerk's server helpers", (f) => {
    expect(read(f)).not.toMatch(/@clerk\/nextjs\/server/);
    expect(read(f)).not.toMatch(/\bauth\(\)/);
  });

  it.each(ROUTES)("%s refuses a missing user ID right after reading it", (f) => {
    const src = read(f);
    const reads = [...src.matchAll(/const userId = await routeUserId\(\);/g)];
    expect(reads.length).toBeGreaterThan(0);
    for (const m of reads) {
      const after = src.slice(m.index! + m[0].length);
      const guard = after.indexOf("if (!userId)");
      expect(guard).toBeGreaterThan(-1);
      // Between the read and the refusal, nothing uses the ID except a log line.
      const between = after.slice(0, guard).split("\n").filter((l) => /userId/.test(l));
      expect(between.every((l) => /^\s*console\.log\(/.test(l)), between.join("\n")).toBe(true);
    }
  });
});
