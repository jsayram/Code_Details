// E03 slice 2a: the Supabase fallback is gone. The project, profile, tag and
// admin reads (and the last Supabase writes behind them) come from Convex only;
// with no local Convex and Better Auth they refuse (fail closed) and never
// touch the database. The removed modules stay removed.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../..");
const exists = (f: string) => fs.existsSync(path.join(root, f));
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const src = execSync("git ls-files --cached --others --exclude-standard -- src", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/db/"));

describe("removed", () => {
  it("the Supabase reader, viewer read, data-default switch, debug page and dead stats route", () => {
    for (const f of [
      "src/backend/projects/supabase-reader.ts",
      "src/backend/projects/viewer-read.ts",
      "src/backend/data-default.ts",
      "src/db/profile-read.ts",
      "src/app/test-cache",
      "scripts/test-cache.ts",
      "src/app/api/profiles/[username]/stats",
    ]) expect(exists(f), f).toBe(false);
  });

  it("the Supabase read actions are no longer exported from the project actions", () => {
    const actions = read("src/app/actions/projects.ts");
    for (const name of ["getProjectById", "getProjectBySlugServer", "getProject", "getUserOwnProjects", "getProjectTagCounts"]) {
      expect(actions, name).not.toMatch(new RegExp(`export (async )?function ${name}\\b`));
    }
    expect(read("src/app/actions/tags.ts")).not.toMatch(/getCachedAllTags/);
  });

  it("nothing outside src/db runs a Supabase query", () => {
    const hits = src.filter((f) => /\bexecuteQuery\b|from ["']@\/db\/server["']|from ["']@\/db\/(project-read|project-write|profile-write|favorite-write|actions)["']/.test(read(f)));
    expect(hits).toEqual([]);
  });
});

const session = { signedIn: false, role: null as string | null };
const dbCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/auth-server", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  betterAuthSignedIn: async () => session.signedIn,
  betterAuthRole: async () => session.role,
  viewerQuery: async () => {
    throw new Error("no Convex in this test");
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
// Any Supabase query from the code under test would land here.
vi.mock("@/db/server", () => ({
  executeQuery: async () => {
    dbCalls.n++;
    throw new Error("the Supabase database was queried");
  },
}));

const url = (p: string) => new NextRequest(new URL(p, "http://localhost:3100"));
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

describe("without a local Convex everything refuses and nothing reads Supabase", () => {
  beforeEach(() => {
    // No Convex URLs: the read switch answers "none" (the test env is not development anyway).
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "");
    vi.stubEnv("CODEDETAILS_CONVEX_SITE_URL", "");
    session.signedIn = true;
    session.role = "admin";
    dbCalls.n = 0;
  });

  it("the read switch has no backend and the public reader finds nothing", async () => {
    const { chooseProjectReadBackend, getProjectReadBackend } = await import("../../src/backend/projects/index.js");
    expect(chooseProjectReadBackend()).toMatchObject({ backend: "none" });
    expect(getProjectReadBackend().name).toBe("none");
    expect(await getProjectReadBackend().getPublicProjectBySlug("fixture-listed")).toBeNull();
  });

  it("the list, count, profile and shared-projects routes answer 500 with the reason", async () => {
    const { DATA_UNAVAILABLE } = await import("../../src/backend/projects/personal.js");
    const responses = [
      await (await import("../../src/app/api/projects/route.js")).GET(url("/api/projects?showAll=true")),
      await (await import("../../src/app/api/projects/route.js")).GET(url("/api/projects?showDeleted=true")),
      await (await import("../../src/app/api/projects/route.js")).GET(url("/api/projects?slug=fixture-listed")),
      await (await import("../../src/app/api/categories/counts/route.js")).GET(url("/api/categories/counts")),
      await (await import("../../src/app/api/categories/counts/route.js")).GET(url("/api/categories/counts?favorites=true")),
      await (await import("../../src/app/api/profiles/route.js")).GET(),
      await (await import("../../src/app/api/profiles/[username]/route.js")).GET(url("/api/profiles/someone"), params({ username: "someone" })),
      await (await import("../../src/app/api/profiles/lookup/[username]/route.js")).GET(url("/api/profiles/lookup/someone"), params({ username: "someone" })),
      await (await import("../../src/app/api/shared-projects/[username]/route.js")).GET(url("/api/shared-projects/someone"), params({ username: "someone" })),
      await (await import("../../src/app/api/shared-projects/[username]/categories/route.js")).GET(url("/api/shared-projects/someone/categories"), params({ username: "someone" })),
      await (await import("../../src/app/api/projects/[id]/tag-submissions/route.js")).GET(url("/api/projects/x/tag-submissions"), params({ id: "x" })),
      await (await import("../../src/app/api/projects/slug/[slug]/route.js")).GET(url("/api/projects/slug/fixture-listed"), params({ slug: "fixture-listed" })),
    ];
    for (const res of responses) {
      expect(res.status).toBe(500);
      expect(await res.text()).toContain(DATA_UNAVAILABLE);
    }
    expect(dbCalls.n).toBe(0);
  });

  it("the profile edit still validates first, then refuses", async () => {
    const { PUT } = await import("../../src/app/api/profiles/[username]/route.js");
    const put = (body: unknown) =>
      PUT(new NextRequest(new URL("/api/profiles/someone", "http://localhost:3100"), { method: "PUT", body: JSON.stringify(body) }), params({ username: "someone" }));
    expect((await put({ email_address: "x@synthetic.invalid" })).status).toBe(400);
    expect((await put({ full_name: "Someone" })).status).toBe(500);
    expect(dbCalls.n).toBe(0);
  });

  it("the admin, tag and dashboard actions pass their checks, then refuse", async () => {
    const { DATA_UNAVAILABLE } = await import("../../src/backend/projects/personal.js");
    const unavailable = new RegExp(DATA_UNAVAILABLE.replace(/[()]/g, "\\$&"));
    await expect((await import("../../src/app/actions/admin-dashboard.js")).fetchAdminDashboardData()).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/advanced-analytics.js")).fetchTopContributors(5)).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/advanced-analytics.js")).fetchTopContributorsPublic(5)).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/advanced-analytics.js")).fetchTagPipelineAnalytics()).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/tag-submissions.js")).getPendingTagSubmissions()).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/tag-submissions.js")).approveTagSubmission("k1")).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/tag-submissions.js")).rejectTagSubmission("k1", "no")).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/user-management.js")).fetchAllUsersAction()).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/user-management.js")).updateUserAction("k1", { full_name: "x" })).rejects.toThrow(unavailable);
    await expect((await import("../../src/app/actions/user-dashboard.js")).fetchUserDashboardData()).rejects.toThrow(/Unauthorized/);
    await expect((await import("../../src/app/actions/tags.js")).getTags()).rejects.toThrow(/Failed to fetch tags/);
    expect(await (await import("../../src/app/actions/tags.js")).searchTagsAction("x")).toEqual([]);
    expect(await (await import("../../src/app/actions/share.js")).getMyShareUsername()).toBeNull();
    expect(dbCalls.n).toBe(0);
  });

  it("the image reads find nothing", async () => {
    const images = await import("../../src/app/actions/project-images.js");
    expect(await images.getProjectImagesAction("k1")).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
    expect(await images.getProjectCoverImageAction("k1")).toEqual({ success: true, data: null });
    expect(dbCalls.n).toBe(0);
  });
});
