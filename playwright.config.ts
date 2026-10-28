// Browser tests (Phase B, B04+). They run against a `next dev` server started
// with a fully synthetic environment (tests/support/isolation.ts) on top of the
// task-owned test database with synthetic fixtures loaded. Pages may only reach
// the test server; see tests/e2e/support.ts.
import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { SYNTHETIC, isolatedEnv } from "./tests/support/isolation";
import { RUNTIME_DIR, readTestDbPassword } from "./tests/support/test-db";

const PORT = 3100;
const password = readTestDbPassword();
if (!password) throw new Error("Browser tests need the isolated test database: run tests/db/provision.sh");

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
