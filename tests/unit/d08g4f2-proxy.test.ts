// D08g4f2: the proxy without Clerk. One path for every request; with Better
// Auth off there is no login, so every protected route is refused (pages go to
// /sign-in, APIs answer 401) and Better Auth's own endpoints aren't public.
// The route classes match as Clerk's createRouteMatcher did: whole path,
// case-insensitive, optional trailing slash.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ value: null as { role: "user" | "admin" } | null, calls: 0 }));
vi.mock("@/lib/auth-server", () => ({
  viewerForCookies: async () => {
    viewer.calls++;
    return viewer.value;
  },
}));

import proxy from "@/proxy";
import { isAdminPath, isBetterAuthPath, isPublicPath } from "@/backend/auth/proxy-rules";

const on = { NODE_ENV: "development", CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210", CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211" };
const SESSION = "better-auth.session_token=synthetic";

function env(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) vi.stubEnv(k, v);
}
async function call(path: string, cookie?: string) {
  const res = await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} }));
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location).pathname + new URL(location).search : null };
}

afterEach(() => {
  vi.unstubAllEnvs();
  viewer.value = null;
  viewer.calls = 0;
});

const PROTECTED_PAGES = ["/dashboard", "/projects/new/edit", "/projects/favorites/x", "/github-scrapper", "/settings"];
const PROTECTED_APIS = ["/api/projects/x", "/api/profiles/me", "/api/llm", "/trpc/x"];
const ADMIN = ["/dashboard/admin", "/dashboard/tag-submissions", "/api/projects/test", "/api/darkmodetest", "/api/toasttest"];

describe("with Better Auth off (no login)", () => {
  it.each([
    ["production", { NODE_ENV: "production" }],
    ["development without local Convex URLs", { NODE_ENV: "development" }],
    ["CODEDETAILS_AUTH_BACKEND=clerk", { ...on, CODEDETAILS_AUTH_BACKEND: "clerk" }],
  ])("%s: protected pages go to /sign-in, APIs get 401, admin too, even with a session cookie", async (_name, values) => {
    env(values);
    for (const p of [...PROTECTED_PAGES, "/dashboard/admin"]) {
      expect(await call(p, SESSION), p).toEqual({ status: 307, location: `/sign-in?redirect_url=${encodeURIComponent(p)}` });
    }
    for (const p of [...PROTECTED_APIS, "/api/projects/test"]) expect((await call(p, SESSION)).status, p).toBe(401);
    // Better Auth's endpoints aren't public with it off.
    expect((await call("/api/auth/get-session")).status).toBe(401);
    expect((await call("/api/dev/viewer")).status).toBe(401);
    expect(viewer.calls, "no session lookup without a login").toBe(0);
  });

  it("public routes still pass", async () => {
    env({ NODE_ENV: "production" });
    for (const p of ["/", "/sign-in", "/sign-up/verify", "/projects/some-slug", "/projects/users/alice", "/shared-projects/x", "/api/shared-projects/x"]) {
      expect(await call(p), p).toEqual({ status: 200, location: null });
    }
  });

  it("the deleted Clerk routes aren't public any more", async () => {
    env({ NODE_ENV: "production" });
    expect((await call("/api/webhook/clerk")).status).toBe(401);
    expect((await call("/api/auth/sync-user")).status).toBe(401);
  });
});

describe("with Better Auth on", () => {
  it("signed out: protected routes are refused; Better Auth's endpoints are public", async () => {
    env(on);
    expect(await call("/dashboard")).toEqual({ status: 307, location: "/sign-in?redirect_url=%2Fdashboard" });
    expect((await call("/api/projects/x")).status).toBe(401);
    expect(await call("/api/auth/get-session")).toEqual({ status: 200, location: null });
  });

  it("a session cookie that doesn't resolve is signed out", async () => {
    env(on);
    expect((await call("/dashboard", SESSION)).status).toBe(307);
    expect(viewer.calls).toBe(1);
  });

  it("a user passes protected routes; admin routes send them to /dashboard; an admin passes", async () => {
    env(on);
    viewer.value = { role: "user" };
    expect(await call("/dashboard", SESSION)).toEqual({ status: 200, location: null });
    for (const p of ADMIN) {
      const r = await call(p, SESSION);
      expect(r, p).toEqual({ status: 307, location: "/dashboard" });
    }
    viewer.value = { role: "admin" };
    for (const p of ADMIN) expect(await call(p, SESSION), p).toEqual({ status: 200, location: null });
  });
});

describe("route classes (as Clerk's matcher)", () => {
  it("are case-insensitive and allow a trailing slash, so a variant can't skip the admin check", () => {
    for (const p of ["/Dashboard/Admin", "/DASHBOARD/ADMIN/users", "/dashboard/admin/", "/Api/DarkModeTest"]) expect(isAdminPath(p), p).toBe(true);
    expect(isPublicPath("/SIGN-IN")).toBe(true);
    expect(isBetterAuthPath("/API/AUTH/get-session")).toBe(true);
  });

  it("match the whole path", () => {
    expect(isPublicPath("/projects/a/b")).toBe(false); // /projects/:slug is one segment
    expect(isPublicPath("/projects")).toBe(true); // D09 S02c: the community list is public now
    expect(isPublicPath("/projectsx")).toBe(false);
    expect(isPublicPath("/sign-inx")).toBe(true); // "/sign-in(.*)", as before
    expect(isAdminPath("/dashboard")).toBe(false);
    expect(isAdminPath("/x/dashboard/admin")).toBe(false);
    expect(isBetterAuthPath("/api/authx")).toBe(false);
  });
});
