// H1: a route the proxy keeps behind sign-in must never ask a shared cache
// (CDN, proxy, Next's own) to keep its answer. Sweeps every API route file:
// any shared-cache hint (public / s-maxage / stale-while-revalidate, or a
// `revalidate` segment export) must be on a path the proxy lists as public.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/backend/auth/proxy-rules";

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

const SHARED_CACHE = /public\s*,|s-maxage|stale-while-revalidate|export\s+const\s+revalidate\s*=\s*[1-9]/i;

describe("API cache headers", () => {
  const files = routeFiles(API);

  it("finds the API routes", () => expect(files.length).toBeGreaterThan(10));

  it("only public routes ask a shared cache to keep an answer", () => {
    const offenders = files
      .filter((f) => SHARED_CACHE.test(fs.readFileSync(f, "utf8")))
      .map((f) => urlFor(f))
      .filter((url) => !isPublicPath(url));
    expect(offenders).toEqual([]);
  });

  it("/api/profiles is private and dynamic", () => {
    const src = fs.readFileSync(path.join(API, "profiles", "route.ts"), "utf8");
    expect(src).toContain("'private, no-store'");
    expect(src).not.toMatch(/export const revalidate/);
  });
});
