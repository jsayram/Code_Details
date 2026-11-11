// D08g4i: what still keys on Clerk-era subjects. Real data holds no Clerk links
// any more (3220 and 3240: 0 rows, read-only count 2026-10-30), but the Supabase
// fallback reads and the generated docs written before the re-key are keyed by
// Clerk user IDs, and the D01 personas carry Clerk links for those tests. This
// ratchet lists every app file that still reads a Clerk-era subject; E03 took
// the Supabase paths out, and the docs re-key shrinks the rest. A new file needs a reason.
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

// E03: the Supabase fallback reads and their Clerk-era viewer (routeViewer,
// routeUserId, DocOwner.projectViewer) are gone. What is left: generated docs
// written before the re-key keep the Clerk subject (_meta.json userId or legacyUserId).
// E03 (2c): docOwner's legacy key is gone and generate-docs no longer writes
// it; these two only strip it from responses and type the old metadata field.
const DOCS = [
  "src/lib/docs-access.ts",
  "src/lib/output-utils.ts",
];

describe("Clerk-era subject readers", () => {
  it("only the listed files read a Clerk-era subject", () => {
    expect(src.filter((f) => f !== "src/lib/auth-server.ts" && LEGACY.test(read(f))).sort()).toEqual([...DOCS].sort());
  });

  it("auth-server no longer exports the Clerk-era viewer (E03)", () => {
    expect(read("src/lib/auth-server.ts")).not.toMatch(/export async function (routeViewer|routeUserId)\b|projectViewer\s*[:=]/);
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
