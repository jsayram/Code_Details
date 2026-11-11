import { defineConfig } from "vitest/config";

// The package's own unit tests, runnable with `npm test -w repo-docs`. The
// app's root `npm test` also runs them, under the app's stricter isolation.
export default defineConfig({
  envDir: false,
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/support/setup.ts"],
    restoreMocks: true,
  },
});
