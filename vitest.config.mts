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
    include: ["tests/{unit,component,integration}/**/*.test.{ts,tsx}"],
    environment: "node",
    // Fail-closed isolation (B08): synthetic env, sockets only to the test DB.
    setupFiles: ["tests/support/vitest-setup.ts"],
    restoreMocks: true,
    // Integration files share one test database; run files one at a time.
    fileParallelism: false,
    // Node 26 defines its own (empty) localStorage global, which hides jsdom's.
    execArgv: ["--no-experimental-webstorage"],
  },
});
