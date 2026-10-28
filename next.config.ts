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
    ],
  },
};

export default nextConfig;
