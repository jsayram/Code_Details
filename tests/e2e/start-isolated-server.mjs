// Starts `next dev` for browser tests with exactly the environment that
// playwright.config.ts wrote to .test-runtime/server-env.json (already checked
// by assertIsolatedEnv). The parent shell's variables are not inherited.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVE } from "../support/slot.cjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(here, "../..");
// The active test slot's state folder (.test-runtime/ for slot 0).
const runtimeDir = path.join(root, ACTIVE.runtimeDir);
const envFile = path.join(runtimeDir, "server-env.json");
const env = JSON.parse(fs.readFileSync(envFile, "utf8"));
const port = process.argv[2] || String(ACTIVE.nextPort);
if (Number(port) !== ACTIVE.nextPort) throw new Error(`test slot ${ACTIVE.slot} serves Next on ${ACTIVE.nextPort}, not ${port}`);

env.NODE_OPTIONS = `--import ${path.join(here, "server-net-guard.mjs")}`;
// D08b: this server also may not reach the import backend (server-net-guard.mjs).
env.CODEDETAILS_NET_GUARD_APP_SERVER = "1";

// next dev also rewrites next-env.d.ts for .next-test; tests/e2e/global-teardown.ts
// puts it back, since Playwright stops this process without running exit hooks.

// D08f1: everything the server prints also goes to .test-runtime/next-server.log
// (truncated at each start), so a browser test can check what got logged.
const logFile = fs.openSync(path.join(runtimeDir, "next-server.log"), "w", 0o600);
const child = spawn(path.join(root, "node_modules/.bin/next"), ["dev", "--hostname", "localhost", "--port", port], {
  cwd: root,
  env,
  stdio: ["inherit", "pipe", "pipe"],
});
for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  from.on("data", (chunk) => {
    to.write(chunk);
    fs.writeSync(logFile, chunk);
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
