// D08e: copies GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, and nothing else,
// from Jose's .env.local to the manual-check backend on 127.0.0.1:3230
// (Jose, 2026-10-29, "Separate manual backend"). Jose runs it himself; the
// values never appear on a command line, in shell history or in this
// script's output. They are piped to `convex env set NAME` on stdin.
//
// Refuses unless the target is the manual backend, so the real values can't
// land on the test backend (3210) or the import backend (3220). Every .env*
// file is hashed before and after; any change fails loudly.
//
// Usage:
//   node scripts/dev-auth/set-github-secrets.mjs [--env-file <path>]
//   node scripts/dev-auth/set-github-secrets.mjs --remove
// --env-file defaults to .env.local in this checkout.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAMES = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"];

const argv = process.argv.slice(2);
const remove = argv.includes("--remove");
const fileFlag = argv.indexOf("--env-file");
const sourceFile = path.resolve(fileFlag === -1 ? path.join(root, ".env.local") : argv[fileFlag + 1]);

const targetEnv = path.join(root, ".test-runtime/convex-manual.env");
if (!fs.existsSync(targetEnv)) {
  console.error("no manual backend: run scripts/dev-auth/backend-up.sh and `node tests/convex/push.mjs --target manual` first");
  process.exit(1);
}
const target = dotenv.parse(fs.readFileSync(targetEnv));
const url = new URL(target.CONVEX_SELF_HOSTED_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "3230") {
  console.error("refusing: the target is not the manual backend on 127.0.0.1:3230");
  process.exit(1);
}

const digest = (dir) =>
  fs.readdirSync(dir).filter((f) => f.startsWith(".env")).sort()
    .map((f) => `${f}:${createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")}`).join("\n");
const dirs = [...new Set([root, path.dirname(sourceFile)])];
const before = dirs.map(digest).join("\n");

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  CONVEX_SELF_HOSTED_URL: target.CONVEX_SELF_HOSTED_URL,
  CONVEX_SELF_HOSTED_ADMIN_KEY: target.CONVEX_SELF_HOSTED_ADMIN_KEY,
  NODE_OPTIONS: `--import ${path.join(root, "tests/e2e/server-net-guard.mjs")}`,
};
const convex = (args, input) =>
  spawnSync(path.join(root, "node_modules/.bin/convex"), args, { cwd: root, env, input, stdio: ["pipe", "ignore", "inherit"] });

let failed = false;
if (remove) {
  for (const name of NAMES) {
    const res = convex(["env", "remove", name]);
    console.log(res.status === 0 ? `removed ${name} from the manual backend` : `could not remove ${name}`);
    failed ||= res.status !== 0;
  }
} else {
  if (!fs.existsSync(sourceFile)) {
    console.error(`no such file: ${sourceFile}`);
    process.exit(1);
  }
  const source = dotenv.parse(fs.readFileSync(sourceFile));
  for (const name of NAMES) {
    const value = (source[name] ?? "").trim();
    if (!value) {
      console.error(`${name} is missing or empty in ${sourceFile}; nothing was set`);
      process.exit(1);
    }
    if (/SYNTHETIC/i.test(value)) {
      console.error(`${name} looks like a test placeholder; nothing was set`);
      process.exit(1);
    }
  }
  for (const name of NAMES) {
    const res = convex(["env", "set", name], `${source[name].trim()}\n`);
    console.log(res.status === 0 ? `set ${name} on the manual backend` : `could not set ${name}`);
    failed ||= res.status !== 0;
  }
}

if (dirs.map(digest).join("\n") !== before) {
  console.error("an .env file changed while this ran; check it before continuing");
  process.exit(2);
}
process.exit(failed ? 1 : 0);
