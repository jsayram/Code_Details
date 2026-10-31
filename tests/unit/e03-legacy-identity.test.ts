// E03 slice 2c: the Clerk-era identity remainder is gone. authLinks holds
// "better-auth" links only; identity:legacySubject and identity:clerkSubjectMap
// are gone; docOwner has no legacy key and new docs carry none; the importer and
// the fixtures key source subjects in importMap, never as an auth link.
// img.clerk.com stays only where imported Clerk-era avatar URLs are accepted
// and shown (the D00b importer's mapping, AVATAR_HOSTS, next.config).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const tracked = (dir: string) =>
  execSync(`git ls-files --cached --others --exclude-standard -- ${dir}`, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.includes("/_generated/"));
const code = (f: string) => read(f).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Clerk-era identity", () => {
  it("authLinks.provider is \"better-auth\" only", () => {
    const schema = code("convex/schema.ts");
    const authLinks = schema.slice(schema.indexOf("authLinks: defineTable"), schema.indexOf("})", schema.indexOf("authLinks: defineTable")));
    expect(authLinks).toMatch(/provider: v\.literal\("better-auth"\)/);
    expect(authLinks).not.toMatch(/"clerk"/);
  });

  it("no Convex code writes or reads a \"clerk\" provider, legacySubject or clerkSubjectMap", () => {
    const hits = tracked("convex").filter((f) => /provider:\s*"clerk"|eq\("provider",\s*"clerk"\)|\blegacySubject\b|\bclerkSubjectMap\b/.test(code(f)));
    expect(hits).toEqual([]);
  });

  it("the importer and the fixtures insert no auth link for a source subject", () => {
    expect(code("convex/importCore.ts")).not.toMatch(/insert\("authLinks"/);
    expect(code("convex/importCore.ts")).toMatch(/store\.map\("profiles\.subject"/);
    expect(code("convex/fixtures.ts")).not.toMatch(/insert\("authLinks", \{[^}]*provider: "clerk"/);
  });

  it("docOwner has no legacy key, and new docs are written without one", () => {
    const auth = code("src/lib/auth-server.ts");
    expect(auth).not.toMatch(/legacyUserId|legacySubject/);
    expect(code("src/app/api/generate-docs/route.ts")).not.toMatch(/legacyUserId/);
    expect(code("src/lib/docs-access.ts")).not.toMatch(/meta\.legacyUserId/);
  });

  it("img.clerk.com is accepted only where imported avatars are mapped, allowed and shown", () => {
    const hits = [...tracked("src"), ...tracked("convex"), ...tracked("scripts"), "next.config.ts"].filter((f) => code(f).includes("img.clerk.com")).sort();
    expect(hits).toEqual(["convex/accountRules.ts", "next.config.ts", "scripts/d00b-import/mapping.ts"]);
  });
});
