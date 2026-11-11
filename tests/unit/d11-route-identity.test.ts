// D11: the docs and generator routes take their identity from the session and
// each still refuses a missing one before anything else uses it. Generator
// re-key: that identity is routeDocOwner() (Clerk by default; behind the
// switch the account's own Convex ID, plus its own Clerk-era subject), and doc
// ownership is decided only by isDocOwner/readableDoc, never by comparing
// meta.userId with one ID.
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

  it.each(ROUTES)("%s refuses a missing identity right after reading it", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/routeUserId|routeViewer/);
    const reads = [
      ...[...src.matchAll(/const userId = \(await routeDocOwner\(\)\)\?\.writeKey \?\? null;/g)].map((m) => ({ m, name: "userId" })),
      ...[...src.matchAll(/const owner = await routeDocOwner\(\);/g)].map((m) => ({ m, name: "owner" })),
    ];
    // D08 gate: the model routes may read the session through requireLlmAdmin
    // (checked below), refusing on the very next line.
    const gated = [...src.matchAll(/const admin = await requireLlmAdmin\(\);\n\s*if \(!admin\.ok\) return /g)];
    expect(reads.length + gated.length).toBeGreaterThan(0);
    for (const { m, name } of reads) {
      const after = src.slice(m.index! + m[0].length);
      // generate-docs derives `userId` from `owner` and refuses on that
      const guard = Math.max(after.indexOf(`if (!${name})`), name === "owner" ? after.indexOf("if (!userId)") : -1);
      expect(guard).toBeGreaterThan(-1);
      // Between the read and the refusal, nothing uses the identity except deriving the key.
      const between = after.slice(0, guard).split("\n").filter((l) => new RegExp(`\\b${name}\\b`).test(l));
      expect(between.every((l) => /^\s*const userId = owner\?\.writeKey \?\? null;$/.test(l)), between.join("\n")).toBe(true);
    }
  });

  it("D08 gate: requireLlmAdmin refuses a missing role or identity right after reading each", () => {
    const src = read("src/backend/llm/gate.ts");
    expect(src).not.toMatch(/routeUserId|routeViewer/);
    expect(src).toMatch(/const role = await betterAuthRole\(\);\n\s*if \(!role\) return refuse\(401/);
    expect(src).toMatch(/if \(role !== "admin"\) return NOT_ADMIN;/);
    expect(src).toMatch(/const accountId = \(await routeDocOwner\(\)\)\?\.writeKey \?\? null;\n\s*if \(!accountId\) return refuse\(401/);
  });

  it.each([...ROUTES, "src/app/api/docs/[slug]/meta/route.ts", "src/app/api/docs/[slug]/download/route.ts"])(
    "%s never decides doc ownership by comparing one user ID",
    (f) => {
      expect(read(f)).not.toMatch(/\.userId\s*[!=]==|[!=]==\s*\w+\.userId/);
    },
  );
});
