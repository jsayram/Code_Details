// `next build` with the synthetic test environment (Phase B, B12). Since E03
// the app has no database client, so the build gets no DATABASE_URL at all, and
// the socket guard refuses anything outside loopback. Output goes to
// .next-test, never .next. Used by CI and runnable locally.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "../support/isolation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const env = isolatedEnv(
  {
    CODEDETAILS_TEST_DIST_DIR: ".next-test",
  },
  undefined,
  { devServer: true },
);
env.NODE_ENV = "production";
env.NODE_OPTIONS = `--import ${path.join(root, "tests/e2e/server-net-guard.mjs")}`;

// next build rewrites the tracked next-env.d.ts for its dist dir; put it back.
const nextEnvFile = path.join(root, "next-env.d.ts");
const nextEnv = fs.readFileSync(nextEnvFile);
const result = spawnSync(path.join(root, "node_modules/.bin/next"), ["build"], { cwd: root, env, stdio: "inherit" });
fs.writeFileSync(nextEnvFile, nextEnv);
process.exit(result.status ?? 1);
