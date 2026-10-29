// Pushes convex/ (schema + functions) to the task-owned local backend started by
// tests/convex/up.sh (Phase C, C07). Uses `convex deploy` against a
// self-hosted URL: unlike `convex dev`, it never writes NEXT_PUBLIC_CONVEX_URL
// into .env.local (C07 found `dev` does, even with --env-file). The CLI runs
// with the loopback-only socket guard, and every .env* file is hashed before
// and after; any change fails the push loudly.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVE as slot } from "../support/slot.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// D00b: `--target import` pushes to the import backend instead
// (scripts/d00b-import/backend-up.sh, 127.0.0.1:3220). It gets its own
// throwaway issuer and CODEDETAILS_IMPORT_ALLOWED, never the fixtures flag,
// so fixtures:clear can't run there and the importer can't run on 3210.
const argv = process.argv.slice(2);
const targetFlag = argv.indexOf("--target");
const target = targetFlag === -1 ? "test" : argv[targetFlag + 1];
if (targetFlag !== -1) argv.splice(targetFlag, 2);
// D08e: `--target manual` pushes to the manual-check backend
// (scripts/dev-auth/backend-up.sh, 127.0.0.1:3230) where Jose tries the real
// GitHub app by hand. It gets neither the fixtures nor the import flag, and
// this script never sets GitHub values there (set-github-secrets.mjs does).
if (!["test", "import", "manual"].includes(target)) throw new Error(`unknown --target ${target}`);
const runtime = {
  import: { envFile: ".test-runtime/convex-import.env", state: ".test-runtime/convex-import", port: "3220", up: "scripts/d00b-import/backend-up.sh", allow: "CODEDETAILS_IMPORT_ALLOWED" },
  manual: { envFile: ".test-runtime/convex-manual.env", state: ".test-runtime/convex-manual", port: "3230", up: "scripts/dev-auth/backend-up.sh", allow: null },
  // The active test slot's backend (tests/support/slot.cjs; slot 0: .test-runtime/convex on 3210).
  test: { envFile: `${slot.runtimeDir}/convex.env`, state: `${slot.runtimeDir}/convex`, port: String(slot.convexPort), up: "tests/convex/up.sh", allow: "CODEDETAILS_FIXTURES_ALLOWED" },
}[target];
const envFile = path.join(root, runtime.envFile);
if (!fs.existsSync(envFile)) {
  console.error(`no local Convex backend: run ${runtime.up} first`);
  process.exit(1);
}
const vars = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const targetUrl = new URL(vars.CONVEX_SELF_HOSTED_URL);
if (targetUrl.hostname !== "127.0.0.1") throw new Error("Convex target must be 127.0.0.1");
if (targetUrl.port !== runtime.port) throw new Error(`the ${target} backend must be on port ${runtime.port}`);

const envDigest = () =>
  fs.readdirSync(root).filter((f) => f.startsWith(".env")).sort()
    .map((f) => `${f}:${createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex")}`).join("\n");
const before = envDigest();

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  // So the socket guard below refuses every other test slot's ports.
  ...(slot.slot === 0 ? {} : { CODEDETAILS_TEST_SLOT: String(slot.slot) }),
  CONVEX_SELF_HOSTED_URL: vars.CONVEX_SELF_HOSTED_URL,
  CONVEX_SELF_HOSTED_ADMIN_KEY: vars.CONVEX_SELF_HOSTED_ADMIN_KEY,
  NODE_OPTIONS: `--import ${path.join(root, "tests/e2e/server-net-guard.mjs")}`,
};
// D00a: `--dry-run` asks the backend to evaluate the schema against the
// documents it already holds without committing anything, so it skips the env
// writes too. `--project-dir <dir>` pushes a copy of the project from another
// folder (the schema test's refused-schema check); only with --dry-run.
const dryRun = argv.includes("--dry-run");
const dirFlag = argv.indexOf("--project-dir");
const projectDir = dirFlag === -1 ? root : path.resolve(argv[dirFlag + 1]);
if (dirFlag !== -1) argv.splice(dirFlag, 2);
if (projectDir !== root && !dryRun) throw new Error("--project-dir is only allowed with --dry-run");
const convex = (args) => spawnSync(path.join(root, "node_modules/.bin/convex"), args, { cwd: projectDir, env, stdio: "inherit" });

// D01: a throwaway ES256 issuer stands in for the auth provider on this
// deployment only. Its key pair is made once per state folder, next to the
// backend's own throwaway secrets; convex/auth.config.ts reads the issuer,
// audience and JWKS (as a data: URI) from the deployment env, so no real
// issuer is named in code. Tests sign tokens with the private key
// (tests/fixtures/convex-auth.ts).
const issuerFile = path.join(root, runtime.state, "test-issuer.json");
if (!fs.existsSync(issuerFile)) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const issuer = {
    issuer: "https://auth.synthetic.invalid",
    audience: "codedetails-synthetic",
    kid: `synthetic-${Date.now()}`,
    publicJwk: publicKey.export({ format: "jwk" }),
    privateJwk: privateKey.export({ format: "jwk" }),
  };
  fs.writeFileSync(issuerFile, JSON.stringify(issuer), { mode: 0o600 });
}
const issuer = JSON.parse(fs.readFileSync(issuerFile, "utf8"));
const jwks = { keys: [{ ...issuer.publicJwk, kid: issuer.kid, alg: "ES256", use: "sig" }] };
// D08a: Better Auth on the test backend only. The secret is a throwaway made
// once per state folder, like the issuer above; SITE_URL is the loopback dev
// origin browsers will use at D08b (tests send it as Origin). Email and
// password is enabled here for synthetic users and nowhere else. The import
// backend gets none of this.
const betterAuth = [];
/** A throwaway made once per state folder; SYNTHETIC-marked so the test server's isolation check accepts it. */
function throwawaySecret(name) {
  const file = path.join(root, runtime.state, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `SYNTHETIC-${randomBytes(32).toString("base64url")}`, { mode: 0o600 });
  return fs.readFileSync(file, "utf8").trim();
}
// SEC-D08-RL: the static JWKS (convex/auth.config.ts), so Convex checks tokens
// without fetching them from the auth site. Kept per state folder. Convex won't
// deploy an auth config that reads an unset env var, so the first push sets the
// placeholder "unset" (convex/authRules.ts staticJwks), deploys, asks the
// deployment for its current keys (auth:latestJwks), and deploys again with them.
const jwksFile = path.join(root, runtime.state, "jwks.json");
betterAuth.push(["JWKS", fs.existsSync(jwksFile) ? fs.readFileSync(jwksFile, "utf8").trim() : "unset"]);
if (target === "test") {
  const secretFile = path.join(root, runtime.state, "better-auth-secret");
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  betterAuth.push(
    ["BETTER_AUTH_SECRET", fs.readFileSync(secretFile, "utf8").trim()],
    ["SITE_URL", "http://localhost:3000"],
    ["CODEDETAILS_AUTH_EMAIL_PASSWORD", "1"],
    // D08b: the browser-test server (playwright.config.ts; the slot's Next port, 3100 in slot 0) next to SITE_URL.
    ["CODEDETAILS_AUTH_TRUSTED_ORIGINS", `http://localhost:${slot.nextPort}`],
    // D08e: verification required, as in production; auth emails go to the
    // fake receiver the D08e tests run on 127.0.0.1:3299, or the slot's mail
    // port (nothing listens otherwise, and sending just logs). GitHub gets
    // synthetic values so the provider is registered; they can never complete
    // a real login.
    ["CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION", "1"],
    ["CODEDETAILS_EMAIL_HTTP_URL", `http://127.0.0.1:${slot.mailPort}/api/v1/send`],
    ["GITHUB_CLIENT_ID", "SYNTHETIC-github-client-id"],
    ["GITHUB_CLIENT_SECRET", "SYNTHETIC-github-client-secret"],
    // SEC-D08-RL: the Next.js server's internal secret for its token calls
    // (convex/authRules.ts), a throwaway like the one above; playwright.config.ts
    // gives the browser-test server the same value.
    ["CODEDETAILS_INTERNAL_AUTH_SECRET", throwawaySecret("internal-auth-secret")],
    // SEC-D08-XFF: tests name each synthetic client with a test-only header
    // (convex/authRules.ts), honored only on a loopback site; X-Forwarded-For
    // is ignored, as on every deployment without a trusted-proxy list.
    ["CODEDETAILS_AUTH_TEST_CLIENT_IP", "1"],
  );
}
if (target === "manual") {
  const secretFile = path.join(root, runtime.state, "better-auth-secret");
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  betterAuth.push(
    ["BETTER_AUTH_SECRET", fs.readFileSync(secretFile, "utf8").trim()],
    ["SITE_URL", "http://localhost:3000"],
    ["CODEDETAILS_AUTH_EMAIL_PASSWORD", "1"],
    ["CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION", "1"],
    // The pinned Mailpit from tests/mail/up.sh; its UI is http://127.0.0.1:8025.
    ["CODEDETAILS_EMAIL_HTTP_URL", "http://127.0.0.1:8025/api/v1/send"],
  );
}
let res = { status: 0 };
for (const [name, value] of dryRun ? [] : [
  ["CODEDETAILS_AUTH_ISSUER", issuer.issuer],
  ["CODEDETAILS_AUTH_AUDIENCE", issuer.audience],
  ["CODEDETAILS_AUTH_JWKS", `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`],
  ...betterAuth,
]) {
  if (res.status === 0) res = convex(["env", "set", name, value]);
}
if (res.status === 0) res = convex(["deploy", "--yes", "--typecheck", "disable", ...argv]);
if (res.status === 0 && !dryRun && !fs.existsSync(jwksFile)) {
  const out = spawnSync(path.join(root, "node_modules/.bin/convex"), ["run", "auth:latestJwks"], { cwd: projectDir, env, encoding: "utf8" });
  const jwks = out.status === 0 ? JSON.parse(out.stdout.trim()) : null;
  if (typeof jwks !== "string" || !Array.isArray(JSON.parse(jwks)) || JSON.parse(jwks).length === 0) {
    console.error("could not read the deployment's JWKS for the static auth config");
    res = { status: 1 };
  } else {
    fs.writeFileSync(jwksFile, jwks, { mode: 0o600 });
    res = convex(["env", "set", "JWKS", jwks]);
    if (res.status === 0) res = convex(["deploy", "--yes", "--typecheck", "disable", ...argv]);
  }
}
// Only this task-owned deployment may run the fixture functions (convex/fixtures.ts),
// or, on the import backend, the importer (convex/importer.ts).
if (res.status === 0 && !dryRun && runtime.allow) res = convex(["env", "set", runtime.allow, "1"]);

if (envDigest() !== before) {
  console.error("an .env file changed during the Convex push; restore it before continuing");
  process.exit(2);
}
process.exit(res.status ?? 1);
