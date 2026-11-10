// H1: a route the proxy keeps behind sign-in must never let a shared cache
// (CDN, proxy, Next's own) keep its answer.
// - Behaviour: for every API route file that isn't public, a signed-in request
//   through the proxy gets Cache-Control "private, no-store"; public and auth
//   routes are left to set their own. /api/profiles' own handler sends it too.
// - Source sweep: no gated route asks for a shared cache (public / s-maxage /
//   stale-while-revalidate / a revalidate export).
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ value: { role: "user" } as { role: "user" | "admin" } | null }));
vi.mock("@/lib/auth-server", () => ({ viewerForCookies: async () => viewer.value }));
vi.mock("@/backend/profiles/read", () => ({ convexDirectory: async () => [{ username: "synthetic" }] }));

import proxy from "@/proxy";
import { isAdminPath, isBetterAuthPath, isPublicPath } from "@/backend/auth/proxy-rules";
import { GET as profilesGet } from "@/app/api/profiles/route";

const API = path.resolve(__dirname, "../../src/app/api");

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js)$/.test(e.name) ? [full] : [];
  });
}

/** /api/... URL for a route file, with sample values for [params] and route groups dropped. */
function urlFor(file: string): string {
  const rel = path.relative(API, path.dirname(file)).split(path.sep).filter((p) => p && !/^\(.*\)$/.test(p));
  return "/api/" + rel.map((p) => (/^\[\.\.\..*\]$/.test(p) ? "a/b" : /^\[.*\]$/.test(p) ? "sample" : p)).join("/");
}

const files = routeFiles(API);
const urls = files.map(urlFor);
const gated = urls.filter((u) => !isPublicPath(u) && !isBetterAuthPath(u));
const SHARED_CACHE = /public\s*,|s-maxage|stale-while-revalidate|export\s+const\s+revalidate\s*=\s*[1-9]/i;

beforeEach(() => {
  for (const [k, v] of Object.entries({ NODE_ENV: "development", CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210", CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211" })) vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllEnvs();
  viewer.value = { role: "user" };
});

const throughProxy = (url: string) =>
  proxy(new NextRequest(`http://localhost:3000${url}`, { headers: { cookie: "better-auth.session_token=synthetic" } }));

describe("API cache headers", () => {
  it("finds the API routes, and some are gated", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(gated).toContain("/api/profiles");
    expect(gated.length).toBeGreaterThan(8);
  });

  it("every gated API route, signed in, passes the proxy with private, no-store", async () => {
    for (const url of gated) {
      viewer.value = { role: isAdminPath(url) ? "admin" : "user" };
      const res = await throughProxy(url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("cache-control"), url).toBe("private, no-store");
    }
  });

  it("refusals are not cacheable either", async () => {
    viewer.value = null;
    const res = await throughProxy("/api/profiles");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("public routes keep their own headers (the proxy adds none)", async () => {
    for (const url of urls.filter((u) => isPublicPath(u))) {
      expect((await throughProxy(url)).headers.get("cache-control"), url).toBeNull();
    }
  });

  it("/api/profiles' own answer is private, no-store", async () => {
    const res = await profilesGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("no gated route's source asks a shared cache to keep an answer", () => {
    const offenders = files.filter((f) => SHARED_CACHE.test(fs.readFileSync(f, "utf8"))).map(urlFor).filter((u) => !isPublicPath(u));
    expect(offenders).toEqual([]);
  });
});
