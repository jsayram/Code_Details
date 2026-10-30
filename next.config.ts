import type { NextConfig } from "next";
import { DATA_DEFAULT } from "./src/backend/data-default";

const isolatedTestServer = process.env.CODEDETAILS_ENV_ISOLATED === "1" && !!process.env.CODEDETAILS_TEST_DIST_DIR;

// D06-b: image files on the local Convex backend (/api/storage/<id>), only in
// development with the project read switch on and a loopback http URL, the same
// conditions as chooseProjectReadBackend. Never in a production build.
// D08g4d: an unset or empty switch means the data default, as there.
function localConvexStorage() {
  const read = process.env.CODEDETAILS_PROJECT_READ_BACKEND || DATA_DEFAULT;
  if (process.env.NODE_ENV !== "development" || read !== "convex") return [];
  try {
    const url = new URL(process.env.CODEDETAILS_CONVEX_URL ?? "");
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) return [];
    return [{ protocol: "http" as const, hostname: url.hostname, port: url.port, pathname: "/api/storage/**", search: "" }];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // Browser tests build into their own folder so they never share caches with
  // the normal dev server. Only honored under the isolated test harness.
  distDir: isolatedTestServer ? process.env.CODEDETAILS_TEST_DIST_DIR : ".next",
  // D11s: the test server starts cold every run. With Turbopack's dev
  // filesystem cache, a server restarted on the previous run's cache sent
  // "reloadPage: HMR hash mismatch" and kept reloading the first page that run
  // had compiled, so a browser test on it never settled. The normal dev
  // server keeps the cache.
  ...(isolatedTestServer ? { experimental: { turbopackFileSystemCacheForDev: false } } : {}),
  images: {
    // Allow local development IPs (Supabase local)
    dangerouslyAllowSVG: true,
    dangerouslyAllowLocalIP: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.clerk.dev',
        port: '',
        pathname: '/**',
      },
      // Supabase Storage - Production
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      // Supabase Storage - Local development
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '54321',
        pathname: '/storage/v1/object/public/**',
        search: '',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '54321',
        pathname: '/storage/v1/object/public/**',
        search: '',
      },
      // D02r-c: the isolated test server's stand-in Supabase URL
      // (tests/support/isolation.ts), so signed-in lists of fixture projects
      // with images render under test instead of hitting the error boundary.
      // Only under the isolated test harness; the browser blocks the request.
      ...(process.env.CODEDETAILS_ENV_ISOLATED === "1"
        ? [{ protocol: 'http' as const, hostname: '127.0.0.1', port: '9', pathname: '/storage/v1/object/public/**', search: '' }]
        : []),
      ...localConvexStorage(),
    ],
  },
};

export default nextConfig;
