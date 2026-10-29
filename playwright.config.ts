// Browser tests (Phase B, B04+). They run against a `next dev` server started
// with a fully synthetic environment (tests/support/isolation.ts) on top of the
// task-owned test database with synthetic fixtures loaded. Pages may only reach
// the test server; see tests/e2e/support.ts.
import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { SYNTHETIC, TEST_CONVEX_SITE_URL, TEST_CONVEX_URL, isolatedEnv } from "./tests/support/isolation";
import { convexAvailable } from "./tests/fixtures/convex";
import { RUNTIME_DIR, readTestDbPassword } from "./tests/support/test-db";

const PORT = 3100;
const password = readTestDbPassword();
if (!password) throw new Error("Browser tests need the isolated test database: run tests/db/provision.sh");

// Phase C: CODEDETAILS_E2E_READ_BACKEND=convex runs the same suite with the
// anonymous project read served by the task-owned local Convex backend
// (development-only switch, C14). Default: Supabase, as before.
export const READ_BACKEND = process.env.CODEDETAILS_E2E_READ_BACKEND === "convex" ? "convex" : "supabase";
if (READ_BACKEND === "convex" && !convexAvailable()) {
  throw new Error("Convex browser tests need the local backend: run tests/convex/up.sh and tests/convex/push.mjs");
}
const readBackendEnv: Record<string, string> =
  READ_BACKEND === "convex" ? { CODEDETAILS_PROJECT_READ_BACKEND: "convex", CODEDETAILS_CONVEX_URL: TEST_CONVEX_URL } : {};

// D08b: CODEDETAILS_E2E_AUTH_BACKEND=better-auth also turns on the
// development-only Better Auth switch (/api/auth/* and /api/dev/viewer served
// through the local backend). Clerk stays the login either way.
export const AUTH_BACKEND = process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth" ? "better-auth" : "clerk";
if (AUTH_BACKEND === "better-auth" && !convexAvailable()) {
  throw new Error("Better Auth browser tests need the local backend: run tests/convex/up.sh and tests/convex/push.mjs");
}
// D08d: the same throwaway handover secret tests/convex/push.mjs gave the test backend.
const handoverSecretFile = path.join(RUNTIME_DIR, "convex", "handover-secret");
const authBackendEnv: Record<string, string> =
  AUTH_BACKEND === "better-auth"
    ? {
        CODEDETAILS_AUTH_BACKEND: "better-auth",
        CODEDETAILS_CONVEX_URL: TEST_CONVEX_URL,
        CODEDETAILS_CONVEX_SITE_URL: TEST_CONVEX_SITE_URL,
        ...(fs.existsSync(handoverSecretFile) ? { CODEDETAILS_HANDOVER_SECRET: fs.readFileSync(handoverSecretFile, "utf8").trim() } : {}),
      }
    : {};

// Synthetic Clerk keys whose frontend API is a .invalid host. A pk_live-shaped
// key keeps Clerk's middleware from redirecting signed-out page loads to a
// development-instance handshake on that host.
const clerkHost = Buffer.from("clerk.codedetails.invalid$").toString("base64");
const serverEnv = isolatedEnv(
  {
    CODEDETAILS_TEST_DIST_DIR: ".next-test",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${clerkHost}`,
    CLERK_SECRET_KEY: `sk_test_${SYNTHETIC}_clerk`,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    ...readBackendEnv,
    ...authBackendEnv,
  },
  password,
  { devServer: true },
);
fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(RUNTIME_DIR, "server-env.json"), JSON.stringify(serverEnv), { mode: 0o600 });

const common = {
  baseURL: `http://localhost:${PORT}`,
  channel: "chrome", // the installed Chrome; no Playwright browser download
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light" as const,
  reducedMotion: "reduce" as const,
  serviceWorkers: "block" as const,
  trace: "retain-on-failure" as const,
};

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Visual baselines change only on an explicit --update-snapshots, after review.
  updateSnapshots: "none",
  snapshotPathTemplate: "tests/e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  expect: { timeout: 15_000 },
  timeout: 120_000,
  projects: [
    { name: "desktop-chrome", use: { ...common, viewport: { width: 1280, height: 800 } }, testIgnore: /\.mobile\.spec\.ts$/ },
    {
      name: "mobile-chrome",
      // Pixel 7 emulation in Chrome: mobile viewport, touch, device scale factor and UA.
      use: { ...devices["Pixel 7"], ...common },
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
  webServer: {
    command: `node tests/e2e/start-isolated-server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/favicon.ico`,
    // Never attach to some other server that happens to be on this port.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
