// `next build` with the synthetic test environment (Phase B, B12). The build
// gets a DATABASE_URL (src/db/server.ts throws at import without one) whose
// password matches no database, so prerendering can't read or write data, and
// the socket guard refuses anything outside loopback. Output goes to
// .next-test, never .next. Used by CI and runnable locally.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYNTHETIC, isolatedEnv } from "../support/isolation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clerkHost = Buffer.from("clerk.codedetails.invalid$").toString("base64");

const env = isolatedEnv(
  {
    CODEDETAILS_TEST_DIST_DIR: ".next-test",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${clerkHost}`,
    CLERK_SECRET_KEY: `sk_test_${SYNTHETIC}_clerk`,
  },
  `${SYNTHETIC}-no-such-database`,
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
