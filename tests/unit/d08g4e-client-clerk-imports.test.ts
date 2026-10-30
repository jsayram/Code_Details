// D08g4e: client code reaches the login through the app's adapters in
// src/components/auth, not through @clerk/* directly. A ratchet: the files that
// still import Clerk are listed here and the list only shrinks (g4e2, g4e3,
// g4f). g4g removes the adapters' own Clerk branches and the package.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const files = execSync("git ls-files --cached --others --exclude-standard -- src", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f));
// Comments don't count (a doc example may show the old import).
const withoutComments = (text: string) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
const importsClerk = (f: string) => /from\s*["']@clerk\//.test(withoutComments(fs.readFileSync(path.join(root, f), "utf8")));

// Still on Clerk outside the adapters (g4e3: pages; g4f: server code).
const REMAINING = [
  "src/app/(administrator)/dashboard/admin/AdminDashboardClient.tsx",
  "src/app/(administrator)/dashboard/page.tsx",
  "src/app/(sidebar-footer)/github-scrapper/docs/[slug]/[[...chapter]]/page.tsx",
  "src/app/(sidebar-footer)/github-scrapper/my-docs/page.tsx",
  "src/app/(sidebar-footer)/github-scrapper/page.tsx",
  "src/app/actions/projects.ts",
  "src/app/api/auth/sync-user/route.ts",
  "src/app/api/webhook/clerk/route.ts",
  "src/app/categories/[category]/page.tsx",
  "src/app/categories/page.tsx",
  "src/app/layout.tsx",
  "src/app/projects/deleted/page.tsx",
  "src/app/projects/favorites/page.tsx",
  "src/app/projects/new/page.tsx",
  "src/app/projects/page.tsx",
  "src/app/projects/projects-portfolio/page.tsx",
  "src/app/projects/users/[username]/page.tsx",
  "src/app/search/page.tsx",
  "src/app/tags/[tag]/page.tsx",
  "src/app/tags/page.tsx",
  "src/app/users/page.tsx",
  "src/lib/admin-action.ts",
  "src/lib/auth-server.ts",
  "src/lib/user-sync-utils.ts",
  "src/proxy.ts",
  "src/services/supabase-server.ts",
];

const MOVED_IN_G4E1 = [
  "src/components/sidebar/app-sidebar.tsx",
  "src/components/sidebar/nav-user.tsx",
  "src/components/ui/page-banner.tsx",
  "src/app/auth/ProtectedPage.tsx",
  "src/app/auth/[[...slug]]/page.tsx",
];

const MOVED_IN_G4E2 = [
  "src/components/Projects/ProjectComponents/ProjectCardComponent.tsx",
  "src/components/Projects/ProjectComponents/ProjectContent.tsx",
  "src/components/Projects/ProjectComponents/ProjectFormBase.tsx",
  "src/components/Projects/ProjectComponents/ProjectListComponent.tsx",
  "src/components/Projects/ProjectComponents/ProjectTableViewComponent.tsx",
  "src/components/Projects/ProjectComponents/TagSubmissionModal.tsx",
  "src/hooks/use-SupabaseClerkJWTToken.ts",
  "src/services/supabase.ts",
];

describe("Clerk imports outside the auth adapters", () => {
  it("a commented-out import doesn't count, a real one does", () => {
    expect(/from\s*["']@clerk\//.test(withoutComments('// forwards /api/auth/* here\nimport { auth } from "@clerk/nextjs/server";\n'))).toBe(true);
    expect(/from\s*["']@clerk\//.test(withoutComments("/**\n * import { x } from '@clerk/nextjs';\n */\n// from \"@clerk/nextjs\"\n"))).toBe(false);
    expect(/from\s*["']@clerk\//.test(withoutComments('import { useAuth } from "@clerk/nextjs";'))).toBe(true);
  });

  it("the unused Clerk-Supabase client hook is gone (g4e2)", () => {
    expect(files).not.toContain("src/hooks/use-clerk-supabase-client.ts");
  });

  const outside = files.filter((f) => !f.startsWith("src/components/auth/") && importsClerk(f));

  it("only the listed files still import Clerk", () => {
    expect(outside.filter((f) => !REMAINING.includes(f))).toEqual([]);
  });

  it("the list has no stale entries (shrink it when a file moves off Clerk)", () => {
    expect(REMAINING.filter((f) => !outside.includes(f))).toEqual([]);
  });

  it("the g4e1 and g4e2 files use the adapters", () => {
    for (const f of [...MOVED_IN_G4E1, ...MOVED_IN_G4E2]) {
      expect(files).toContain(f);
      expect(importsClerk(f), f).toBe(false);
    }
  });
});
