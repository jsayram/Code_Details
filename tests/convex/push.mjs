// Pushes convex/ (schema + functions) to the task-owned local backend started by
// tests/convex/up.sh (Phase C, C07). Uses `convex deploy` against a
// self-hosted URL: unlike `convex dev`, it never writes NEXT_PUBLIC_CONVEX_URL
// into .env.local (C07 found `dev` does, even with --env-file). The CLI runs
// with the loopback-only socket guard, and every .env* file is hashed before
// and after; any change fails the push loudly.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(root, ".test-runtime/convex.env");
if (!fs.existsSync(envFile)) {
  console.error("no local Convex backend: run tests/convex/up.sh first");
  process.exit(1);
}
const vars = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (new URL(vars.CONVEX_SELF_HOSTED_URL).hostname !== "127.0.0.1") throw new Error("Convex target must be 127.0.0.1");

const envDigest = () =>
  fs.readdirSync(root).filter((f) => f.startsWith(".env")).sort()
    .map((f) => `${f}:${createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex")}`).join("\n");
const before = envDigest();

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  CONVEX_SELF_HOSTED_URL: vars.CONVEX_SELF_HOSTED_URL,
  CONVEX_SELF_HOSTED_ADMIN_KEY: vars.CONVEX_SELF_HOSTED_ADMIN_KEY,
  NODE_OPTIONS: `--import ${path.join(root, "tests/e2e/server-net-guard.mjs")}`,
};
const res = spawnSync(path.join(root, "node_modules/.bin/convex"), ["deploy", "--yes", "--typecheck", "disable", ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});

if (envDigest() !== before) {
  console.error("an .env file changed during the Convex push; restore it before continuing");
  process.exit(2);
}
process.exit(res.status ?? 1);
