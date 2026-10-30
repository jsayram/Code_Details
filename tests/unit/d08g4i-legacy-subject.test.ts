// D08g4i: what still keys on Clerk-era subjects. Real data holds no Clerk links
// any more (3220 and 3240: 0 rows, read-only count 2026-10-30), but the Supabase
// fallback reads and the generated docs written before the re-key are keyed by
// Clerk user IDs, and the D01 personas carry Clerk links for those tests. This
// ratchet lists every app file that still reads a Clerk-era subject; E03 (the
// Supabase paths out) and the docs re-key shrink it. A new file needs a reason.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const src = execSync("git ls-files --cached --others --exclude-standard -- src", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f));
const LEGACY = /\brouteViewer\(|\brouteUserId\(|\blegacySubject\b|\blegacyUserId\b|\bprojectViewer\b/;

// Supabase fallback reads (E03 removes them): the viewer is the account's Clerk-era subject.
const SUPABASE_FALLBACK = [
  "src/app/actions/projects.ts",
  "src/app/actions/share.ts",
  "src/app/actions/user-dashboard.ts",
  "src/app/api/categories/counts/route.ts",
  "src/app/api/profiles/[username]/route.ts",
  "src/app/api/projects/[id]/tag-submissions/route.ts",
  "src/app/api/projects/route.ts",
  "src/backend/projects/viewer-read.ts",
];
// Generated docs written before the re-key keep the Clerk subject (_meta.json userId or legacyUserId).
const DOCS = [
  "src/app/api/docs/[slug]/link-project/route.ts",
  "src/app/api/generate-docs/route.ts",
  "src/app/api/projects/slug/[slug]/linked-doc/route.ts",
  "src/lib/docs-access.ts",
  "src/lib/output-utils.ts",
];

describe("Clerk-era subject readers", () => {
  it("only the listed files read a Clerk-era subject", () => {
    expect(src.filter((f) => f !== "src/lib/auth-server.ts" && LEGACY.test(read(f))).sort()).toEqual([...SUPABASE_FALLBACK, ...DOCS].sort());
  });

  it("the project page has no Clerk-era signed-in read (it never ran with Better Auth)", () => {
    const page = read("src/app/projects/[slug]/page.tsx");
    expect(page).not.toMatch(/\b(routeViewer|getProjectForViewer|chooseAuthBackend)\(|import[^;]*\b(routeViewer|getProjectForViewer|chooseAuthBackend)\b/);
  });

  it("sessionTier no longer reads the Supabase profile", () => {
    expect(read("src/backend/profiles/session-tier.ts")).not.toMatch(/routeViewer|readTierByUserId|@\/db\//);
  });
});

describe("sessionTier", () => {
  it("is free with no login, and the account's own tier with Better Auth", async () => {
    vi.resetModules();
    const choice = { backend: "none" as string };
    vi.doMock("@/backend/auth", () => ({ chooseAuthBackend: () => choice }));
    vi.doMock("@/lib/auth-server", () => ({ viewerQuery: async () => ({ result: { tier: "pro" } }) }));
    vi.doMock("@/services/tierServiceServer", () => ({ isValidTier: (t: string) => ["free", "pro", "diamond"].includes(t) }));
    const { sessionTier } = await import("../../src/backend/profiles/session-tier.js");
    expect(await sessionTier()).toBe("free");
    choice.backend = "better-auth";
    expect(await sessionTier()).toBe("pro");
    vi.doUnmock("@/backend/auth");
    vi.doUnmock("@/lib/auth-server");
    vi.doUnmock("@/services/tierServiceServer");
  });
});
