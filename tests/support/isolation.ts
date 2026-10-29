// Test isolation contract (Phase B, B08). Every test that could reach a
// service gets its environment from isolatedEnv() and checks it with
// assertIsolatedEnv(). Both fail closed: anything not explicitly allowed is an
// error, never a warning.
//
// Why so strict: every .env file in this repo, .env.test included, targets the
// development Supabase (127.0.0.1:54321 API, 54322 DB) and the hosted Clerk dev
// instance, and .env.local also holds operator LLM/GitHub tokens (Phase A, A02).

import { ACTIVE } from "./slot.cjs";

// Every port below belongs to the active test slot (tests/support/slot.cjs,
// CODEDETAILS_TEST_SLOT, default 0). Slot 0 keeps the original numbers in the comments.

/** Port of the task-owned test Postgres (tests/db/provision.sh), bound to 127.0.0.1 only. Slot 0: 55432. */
export const TEST_DB_PORT: number = ACTIVE.dbPort;
export const TEST_DB_NAME = "postgres";
/** Task-owned local Convex backend (tests/convex/up.sh), client port, 127.0.0.1 only (Phase C). Slot 0: 3210. */
export const TEST_CONVEX_PORT: number = ACTIVE.convexPort;
export const TEST_CONVEX_URL = `http://127.0.0.1:${TEST_CONVEX_PORT}`;
/** Same backend's site port (HTTP actions): Better Auth's /api/auth routes (D08a). Slot 0: 3211. */
export const TEST_CONVEX_SITE_PORT: number = ACTIVE.convexSitePort;
export const TEST_CONVEX_SITE_URL = `http://127.0.0.1:${TEST_CONVEX_SITE_PORT}`;
/** Nothing listens here; supabase-js calls fail fast instead of reaching a real API. */
export const TEST_SUPABASE_URL = "http://127.0.0.1:9";

/** Development Supabase ports: API, DB, Studio, mail, plus the rest of its range. */
export const FORBIDDEN_PORTS = [54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54329];

/** Marker every synthetic credential carries. Anything else is treated as real. */
export const SYNTHETIC = "SYNTHETIC";

const SECRET_NAME = /KEY|TOKEN|SECRET|WEBHOOK|PASSWORD|JWT/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class IsolationError extends Error {
  constructor(problems: string[]) {
    super(`Test isolation check failed:\n- ${problems.join("\n- ")}`);
    this.name = "IsolationError";
  }
}

function hostAllowed(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".invalid");
}

/** Clerk publishable keys are pk_(test|live)_ + base64("<frontend api host>$"). */
export function clerkFrontendHost(publishableKey: string): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(publishableKey);
  if (!m) return null;
  try {
    return Buffer.from(m[1], "base64").toString("utf8").replace(/\$$/, "");
  } catch {
    return null;
  }
}

/** Returns every problem with env; empty means isolated. */
export interface IsolationOptions {
  /**
   * The browser-test Next server runs `next dev` in Next's normal development
   * mode (NODE_ENV=test makes Next rewrite tsconfig.json). Its env files are
   * still never applied: CODEDETAILS_ENV_ISOLATED and __NEXT_PROCESSED_ENV hold.
   */
  devServer?: boolean;
}

export function isolationProblems(env: Record<string, string | undefined>, options: IsolationOptions = {}): string[] {
  const problems: string[] = [];
  const nodeEnv = options.devServer ? "development" : "test";

  if (env.CODEDETAILS_ENV_ISOLATED !== "1") {
    problems.push("CODEDETAILS_ENV_ISOLATED must be 1 (env files would otherwise be loaded)");
  }
  if (env.NODE_ENV !== nodeEnv) problems.push(`NODE_ENV must be ${nodeEnv}, got ${env.NODE_ENV ?? "unset"}`);
  if (options.devServer && env.__NEXT_PROCESSED_ENV !== "true") {
    problems.push("__NEXT_PROCESSED_ENV must be true so Next applies no .env file");
  }

  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;

    for (const port of FORBIDDEN_PORTS) {
      if (new RegExp(`[:/]${port}(?!\\d)`).test(value)) {
        problems.push(`${name} points at development port ${port}`);
      }
    }
    if (/\b[ps]k_live_/.test(value) && !(name.includes("CLERK") && clerkFrontendHost(value)?.endsWith(".invalid"))) {
      problems.push(`${name} looks like a live key`);
    }
    // The Clerk publishable key is public; its host is checked below instead.
    if (SECRET_NAME.test(name) && name !== "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" && !value.includes(SYNTHETIC)) {
      problems.push(`${name} is set to a non-synthetic value`);
    }
    if (/^https?:\/\//.test(value) || /^postgres(ql)?:\/\//.test(value)) {
      let url: URL | null = null;
      try {
        url = new URL(value);
      } catch {
        problems.push(`${name} is not a parseable URL`);
      }
      if (url && !hostAllowed(url.hostname)) problems.push(`${name} points at non-loopback host ${url.hostname}`);
    }
  }

  const db = env.DATABASE_URL;
  if (db) {
    try {
      const url = new URL(db);
      if (Number(url.port) !== TEST_DB_PORT) problems.push(`DATABASE_URL must use port ${TEST_DB_PORT}`);
      if (!LOOPBACK_HOSTS.has(url.hostname)) problems.push("DATABASE_URL must be loopback");
    } catch {
      /* reported above */
    }
  }

  // Any Convex URL must be the task-owned local backend; never a cloud deployment.
  for (const name of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL", "CONVEX_SELF_HOSTED_URL", "CODEDETAILS_CONVEX_URL"]) {
    const value = env[name];
    if (value && value !== TEST_CONVEX_URL) problems.push(`${name} must be ${TEST_CONVEX_URL}`);
  }
  // D08b: the site URL (Better Auth's routes) must be the same backend's site port.
  for (const name of ["CONVEX_SITE_URL", "NEXT_PUBLIC_CONVEX_SITE_URL", "CODEDETAILS_CONVEX_SITE_URL"]) {
    const value = env[name];
    if (value && value !== TEST_CONVEX_SITE_URL) problems.push(`${name} must be ${TEST_CONVEX_SITE_URL}`);
  }
  // A child process must stay on the slot this harness computed its ports for.
  if ((env.CODEDETAILS_TEST_SLOT || "0") !== String(ACTIVE.slot)) {
    problems.push(`CODEDETAILS_TEST_SLOT must match the active test slot ${ACTIVE.slot}`);
  }
  if (env.CONVEX_DEPLOYMENT) problems.push("CONVEX_DEPLOYMENT must not be set (it selects a cloud or CLI-managed deployment)");

  const pk = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (pk) {
    const host = clerkFrontendHost(pk);
    if (!host?.endsWith(".invalid")) problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must decode to a .invalid host");
  }

  return problems;
}

export function assertIsolatedEnv(env: Record<string, string | undefined>, options: IsolationOptions = {}): void {
  const problems = isolationProblems(env, options);
  if (problems.length) throw new IsolationError(problems);
}

const PASSTHROUGH = ["PATH", "HOME", "TMPDIR", "LANG", "TERM", "SHELL", "USER"];

/**
 * Builds a complete environment from scratch: only PATH-like basics are taken
 * from the parent process, everything else is synthetic. Pass the result as
 * the full env of any child process (never merge it into process.env).
 */
export function isolatedEnv(
  extra: Record<string, string> = {},
  dbPassword?: string,
  options: IsolationOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH) {
    const v = process.env[name];
    if (v) env[name] = v;
  }
  Object.assign(env, {
    NODE_ENV: options.devServer ? "development" : "test",
    CODEDETAILS_ENV_ISOLATED: "1",
    // Tells Next's env loader the env is already processed, so it reads no .env file.
    __NEXT_PROCESSED_ENV: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: `${SYNTHETIC}_anon_key`,
    SUPABASE_SERVICE_ROLE_KEY: `${SYNTHETIC}_service_role_key`,
    ADMIN_DASHBOARD_MODERATOR: "admin@synthetic.invalid",
  });
  // Carried so child processes (and Vitest files loaded after the worker's env
  // is replaced) compute the same slot. Slot 0 adds nothing, as before slots.
  if (ACTIVE.slot !== 0) env.CODEDETAILS_TEST_SLOT = String(ACTIVE.slot);
  if (dbPassword !== undefined) {
    env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(dbPassword)}@127.0.0.1:${TEST_DB_PORT}/${TEST_DB_NAME}`;
  }
  Object.assign(env, extra);
  assertIsolatedEnv(env, options);
  return env;
}
