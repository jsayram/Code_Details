import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit and component tests only. Browser tests live in tests/e2e and run with Playwright.
export default defineConfig({
  plugins: [react()],
  // Never read .env, .env.local, .env.test or .env.development: every one of
  // them points at the development database (Phase A, A02).
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    // X3: the engine package's own tests run here too, under the same isolation.
    include: ["tests/{unit,component,integration}/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.ts"],
    environment: "node",
    // Fail-closed isolation (B08): synthetic env, sockets only to the test DB.
    setupFiles: ["tests/support/vitest-setup.ts"],
    restoreMocks: true,
    // Integration files share one test database; run files one at a time.
    fileParallelism: false,
    // Integration tests talk to a real local Convex backend; under load a
    // single call can pass 5s (TEST-D08C-TIMEOUT, D04d purge). Every phase
    // was re-running with a 30s limit, so make it the default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Node 26 defines its own (empty) localStorage global, which hides jsdom's.
    execArgv: ["--no-experimental-webstorage"],
  },
});
