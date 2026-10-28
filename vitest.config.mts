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
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/component/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
    // Node 26 defines its own (empty) localStorage global, which hides jsdom's.
    execArgv: ["--no-experimental-webstorage"],
  },
});
