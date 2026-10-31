// D08g4g: Clerk is gone. The ratchet that shrank through D08g4e/f (client code
// off Clerk, then the server, then ClerkProvider) ends here: no package, no
// import anywhere, none of the removed files, no Clerk env or image host.
// What may still say "clerk": the Clerk-era account links in Convex (until
// g4i), supabase/config.toml, tech detection of other repos, history notes.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
// Tracked files only: the untracked local g4e evidence spec never ships.
const tracked = execSync("git ls-files --cached -- src convex tests scripts", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|cjs|js)$/.test(f));
// Comments don't count (a doc example may show the old import).
const withoutComments = (text: string) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
const importsClerk = (text: string) => /(from\s*|import\(\s*|vi\.mock\(\s*)["']@clerk\//.test(withoutComments(text));

describe("Clerk is gone", () => {
  it("no Clerk package is installed or locked", () => {
    const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string> | undefined>;
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      expect(Object.keys(pkg[group] ?? {}).filter((n) => n.startsWith("@clerk/")), group).toEqual([]);
    }
    expect(read("package-lock.json")).not.toMatch(/"node_modules\/@clerk\//);
  });

  it("nothing in src, convex, tests or scripts imports or mocks Clerk", () => {
    expect(tracked.filter((f) => f !== "tests/unit/d08g4g-no-clerk.test.ts" && importsClerk(read(f)))).toEqual([]);
  });

  it("a commented-out import doesn't count, a real one does", () => {
    expect(importsClerk('// forwards /api/auth/* here\nimport { auth } from "@clerk/nextjs/server";\n')).toBe(true);
    expect(importsClerk("/**\n * import { x } from '@clerk/nextjs';\n */\n// from \"@clerk/nextjs\"\n")).toBe(false);
    expect(importsClerk('vi.mock("@clerk/nextjs", () => ({}));')).toBe(true);
  });

  it("the Clerk-only files are gone", () => {
    for (const gone of [
      "src/app/api/auth/sync-user/route.ts",
      "src/app/api/webhook/clerk/route.ts",
      "src/lib/user-sync-utils.ts",
      "src/services/clerkServerFetchUserService.ts",
      "src/services/supabase-server.ts",
      "src/types/models/clerkUserData.tsx",
      "src/types/models/clerkSessionData.tsx",
      "src/hooks/use-clerk-supabase-client.ts",
      "src/hooks/use-SupabaseClerkJWTToken.ts",
      "src/components/auth/useSupabaseTokenSession.ts",
      "src/backend/auth/context.tsx",
      "tests/e2e/clerk-signed-out-stub.js",
      // E03: the anonymous Supabase client that kept these exports company.
      "src/services/supabase.ts",
    ]) expect(fs.existsSync(path.join(root, gone)), gone).toBe(false);
  });

  it("no Clerk env is required, and only the imported-avatar host stays in next.config", () => {
    expect(read("scripts/validateEnv.ts")).not.toMatch(/CLERK/);
    const config = read("next.config.ts");
    expect(config).not.toContain("images.clerk.dev");
    // img.clerk.com stays: imported profiles keep their avatar URLs (convex/accountRules.ts AVATAR_HOSTS).
    expect(read("convex/accountRules.ts")).toContain('"img.clerk.com"');
  });

  it("the test harness sets no Clerk variable and runs no Clerk mode", () => {
    for (const f of ["playwright.config.ts", "tests/ci/isolated-build.mjs"]) expect(read(f), f).not.toMatch(/CLERK_|AUTH_BACKEND === "clerk"/);
    expect(tracked.filter((f) => f.startsWith("tests/e2e/") && /CODEDETAILS_E2E_AUTH_BACKEND/.test(read(f)))).toEqual([]);
  });
});
