// D11s: the isolated test server runs `next dev` without Turbopack's
// filesystem cache, so every browser run starts cold. Restarted on the previous
// run's cache, it sent "reloadPage: HMR hash mismatch" and kept reloading the
// first page that run had compiled (the docs viewer in the D11 spec). The
// normal dev server is unchanged.
import path from "node:path";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONFIG = path.resolve(__dirname, "../../next.config.ts");

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return ((await import(/* @vite-ignore */ CONFIG)) as { default: NextConfig }).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config under the isolated test harness", () => {
  it("turns the dev filesystem cache off and builds into the test dist dir", async () => {
    const config = await loadConfig({ CODEDETAILS_ENV_ISOLATED: "1", CODEDETAILS_TEST_DIST_DIR: ".next-test" });
    expect(config.distDir).toBe(".next-test");
    expect(config.experimental?.turbopackFileSystemCacheForDev).toBe(false);
  });

  it("leaves the normal dev server alone: default cache, .next", async () => {
    for (const env of [{ CODEDETAILS_ENV_ISOLATED: "", CODEDETAILS_TEST_DIST_DIR: "" }, { CODEDETAILS_ENV_ISOLATED: "1", CODEDETAILS_TEST_DIST_DIR: "" }, { CODEDETAILS_ENV_ISOLATED: "", CODEDETAILS_TEST_DIST_DIR: ".next-test" }]) {
      const config = await loadConfig(env);
      expect(config.distDir).toBe(".next");
      expect(config.experimental?.turbopackFileSystemCacheForDev).toBeUndefined();
    }
  });
});
