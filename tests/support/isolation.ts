// Test isolation contract (Phase B, B08). Every test that could reach a
// service gets its environment from isolatedEnv() and checks it with
// assertIsolatedEnv(). Both fail closed: anything not explicitly allowed is an
// error, never a warning.
//
// Why so strict: every .env file in this repo, .env.test included, targets the
// development Supabase (127.0.0.1:54321 API, 54322 DB) and the hosted Clerk dev
// instance, and .env.local also holds operator LLM/GitHub tokens (Phase A, A02).

/** Port of the task-owned test Postgres (tests/db/provision.sh), bound to 127.0.0.1 only. */
export const TEST_DB_PORT = 55432;
export const TEST_DB_NAME = "postgres";
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
export function isolationProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];

  if (env.CODEDETAILS_ENV_ISOLATED !== "1") {
    problems.push("CODEDETAILS_ENV_ISOLATED must be 1 (env files would otherwise be loaded)");
  }
  if (env.NODE_ENV !== "test") problems.push(`NODE_ENV must be test, got ${env.NODE_ENV ?? "unset"}`);

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

  const pk = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (pk) {
    const host = clerkFrontendHost(pk);
    if (!host?.endsWith(".invalid")) problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must decode to a .invalid host");
  }

  return problems;
}

export function assertIsolatedEnv(env: Record<string, string | undefined>): void {
  const problems = isolationProblems(env);
  if (problems.length) throw new IsolationError(problems);
}

const PASSTHROUGH = ["PATH", "HOME", "TMPDIR", "LANG", "TERM", "SHELL", "USER"];

/**
 * Builds a complete environment from scratch: only PATH-like basics are taken
 * from the parent process, everything else is synthetic. Pass the result as
 * the full env of any child process (never merge it into process.env).
 */
export function isolatedEnv(extra: Record<string, string> = {}, dbPassword?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH) {
    const v = process.env[name];
    if (v) env[name] = v;
  }
  Object.assign(env, {
    NODE_ENV: "test",
    CODEDETAILS_ENV_ISOLATED: "1",
    // Tells Next's env loader the env is already processed, so it reads no .env file.
    __NEXT_PROCESSED_ENV: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: `${SYNTHETIC}_anon_key`,
    SUPABASE_SERVICE_ROLE_KEY: `${SYNTHETIC}_service_role_key`,
    ADMIN_DASHBOARD_MODERATOR: "admin@synthetic.invalid",
  });
  if (dbPassword !== undefined) {
    env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(dbPassword)}@127.0.0.1:${TEST_DB_PORT}/${TEST_DB_NAME}`;
  }
  Object.assign(env, extra);
  assertIsolatedEnv(env);
  return env;
}
