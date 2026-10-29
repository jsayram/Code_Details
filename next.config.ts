import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser tests build into their own folder so they never share caches with
  // the normal dev server. Only honored under the isolated test harness.
  distDir:
    process.env.CODEDETAILS_ENV_ISOLATED === "1" && process.env.CODEDETAILS_TEST_DIST_DIR
      ? process.env.CODEDETAILS_TEST_DIST_DIR
      : ".next",
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
    ],
  },
};

export default nextConfig;
