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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// D00b: `--target import` pushes to the import backend instead
// (scripts/d00b-import/backend-up.sh, 127.0.0.1:3220). It gets its own
// throwaway issuer and CODEDETAILS_IMPORT_ALLOWED, never the fixtures flag,
// so fixtures:clear can't run there and the importer can't run on 3210.
const argv = process.argv.slice(2);
const targetFlag = argv.indexOf("--target");
const target = targetFlag === -1 ? "test" : argv[targetFlag + 1];
if (targetFlag !== -1) argv.splice(targetFlag, 2);
if (!["test", "import"].includes(target)) throw new Error(`unknown --target ${target}`);
const runtime = target === "import"
  ? { envFile: ".test-runtime/convex-import.env", state: ".test-runtime/convex-import", port: "3220", up: "scripts/d00b-import/backend-up.sh", allow: "CODEDETAILS_IMPORT_ALLOWED" }
  : { envFile: ".test-runtime/convex.env", state: ".test-runtime/convex", port: "3210", up: "tests/convex/up.sh", allow: "CODEDETAILS_FIXTURES_ALLOWED" };
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
if (target === "test") {
  const secretFile = path.join(root, runtime.state, "better-auth-secret");
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  betterAuth.push(
    ["BETTER_AUTH_SECRET", fs.readFileSync(secretFile, "utf8").trim()],
    ["SITE_URL", "http://localhost:3000"],
    ["CODEDETAILS_AUTH_EMAIL_PASSWORD", "1"],
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
// Only this task-owned deployment may run the fixture functions (convex/fixtures.ts),
// or, on the import backend, the importer (convex/importer.ts).
if (res.status === 0 && !dryRun) res = convex(["env", "set", runtime.allow, "1"]);

if (envDigest() !== before) {
  console.error("an .env file changed during the Convex push; restore it before continuing");
  process.exit(2);
}
process.exit(res.status ?? 1);
