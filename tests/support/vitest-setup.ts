// Runs before every Vitest file (B08). Replaces the worker's environment with a
// synthetic one and refuses every outbound socket except the task-owned test
// database, so a test can't reach the development Supabase, Clerk, Stripe or an
// LLM provider even by accident.
import net from "node:net";
import { IsolationError, TEST_DB_PORT, isolatedEnv } from "./isolation";
import { readTestDbPassword } from "./test-db";

const env = isolatedEnv({}, readTestDbPassword() ?? undefined);
// Keep Vitest's own worker variables; drop everything else the shell had.
for (const name of Object.keys(process.env)) if (!name.startsWith("VITEST")) delete process.env[name];
Object.assign(process.env, env);

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function target(args: unknown[]): { host?: string; port?: number; path?: string } {
  const [first, second] = args;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const o = first as { host?: string; port?: number | string; path?: string };
    return { host: o.host ?? "localhost", port: o.port === undefined ? undefined : Number(o.port), path: o.path };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { path: first };
  return { port: Number(first), host: typeof second === "string" ? second : "localhost" };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  const t = target(args);
  if (t.path || !t.host || !ALLOWED_HOSTS.has(t.host) || t.port !== TEST_DB_PORT) {
    const where = t.path ?? `${t.host}:${t.port}`;
    throw new IsolationError([`outbound connection to ${where} refused; only 127.0.0.1:${TEST_DB_PORT} is allowed`]);
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
