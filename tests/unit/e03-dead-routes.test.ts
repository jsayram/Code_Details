// E03 slice 1: the dead routes and the Algolia dependency are gone.
// /api/revalidate (P08 R34) let any signed-in caller invalidate tags it chose;
// the admin "Clear cache" button now calls clearServerCaches, which checks the
// admin first and takes no tag argument. GET /api/profiles/by-id had no caller
// (the profile page reads /api/profiles/lookup since D04a).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../..");
const exists = (f: string) => fs.existsSync(path.join(root, f));
const src = execSync("git ls-files --cached --others --exclude-standard -- src", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f));

describe("removed routes", () => {
  it("/api/revalidate and /api/profiles/by-id have no route files", () => {
    expect(exists("src/app/api/revalidate")).toBe(false);
    expect(exists("src/app/api/profiles/by-id")).toBe(false);
  });

  it("nothing in src calls /api/revalidate or /api/profiles/by-id", () => {
    const callers = src.filter((f) => /["'`]\/api\/(revalidate|profiles\/by-id)\b/.test(fs.readFileSync(path.join(root, f), "utf8")));
    expect(callers).toEqual([]);
  });

  it("package.json has no Algolia client", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /algolia/i.test(d))).toEqual([]);
  });
});

const session = { signedIn: false, role: null as string | null };
const revalidateTag = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  betterAuthSignedIn: async () => session.signedIn,
  betterAuthRole: async () => session.role,
}));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidateTag }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
// The dashboard reads are not under test; keep their database and Convex imports out.
vi.mock("@/db/operations/dashboardOperations", () => ({ getDashboardStats: vi.fn() }));
vi.mock("@/db/operations/tag-submission-operations", () => ({ listPendingTagSubmissions: vi.fn() }));
vi.mock("@/backend/projects/project-update", () => ({ projectWritesToConvex: () => true }));
vi.mock("@/backend/projects/tags", () => ({ pendingSuggestionsOnConvex: vi.fn() }));
vi.mock("@/backend/admin", () => ({ dashboardStatsOnConvex: vi.fn() }));

describe("clearServerCaches", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    session.signedIn = false;
    session.role = null;
  });

  it("takes no tag argument", async () => {
    const { clearServerCaches } = await import("../../src/app/actions/admin-dashboard.js");
    expect(clearServerCaches.length).toBe(0);
  });

  it("refuses a signed-out caller and a non-admin without revalidating anything", async () => {
    const { clearServerCaches } = await import("../../src/app/actions/admin-dashboard.js");
    await expect(clearServerCaches()).rejects.toThrow(/Unauthorized/);
    session.signedIn = true;
    session.role = "user";
    await expect(clearServerCaches()).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates every server cache tag for the admin", async () => {
    const { clearServerCaches } = await import("../../src/app/actions/admin-dashboard.js");
    const { CACHE_TAGS } = await import("../../src/lib/swr-fetchers.js");
    session.signedIn = true;
    session.role = "admin";
    expect(await clearServerCaches()).toEqual({ cleared: Object.values(CACHE_TAGS).length });
    expect(revalidateTag.mock.calls.map(([t]) => t).sort()).toEqual(Object.values(CACHE_TAGS).sort());
  });
});
