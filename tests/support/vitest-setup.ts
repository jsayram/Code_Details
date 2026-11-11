// Runs before every Vitest file (B08). Replaces the worker's environment with a
// synthetic one and refuses every outbound socket except the task-owned test
// database (and, from Phase C, the task-owned local Convex backend; from D08a its site
// port too), so a test can't reach the development Supabase, Clerk, Stripe or an
// LLM provider even by accident.
import net from "node:net";
import { IsolationError, TEST_CONVEX_PORT, TEST_CONVEX_SITE_PORT, TEST_DB_PORT, isolatedEnv } from "./isolation";
import { readTestDbPassword } from "./test-db";

const env = isolatedEnv({}, readTestDbPassword() ?? undefined);
// Keep Vitest's own worker variables; drop everything else the shell had.
for (const name of Object.keys(process.env)) if (!name.startsWith("VITEST")) delete process.env[name];
Object.assign(process.env, env);

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const ALLOWED_PORTS = new Set([TEST_DB_PORT, TEST_CONVEX_PORT, TEST_CONVEX_SITE_PORT]);
// H1: a test may open its own throwaway server on loopback and add that port
// here (tests/support/loopback-port.ts). Hosts stay loopback-only.
const TEST_OWNED_PORTS: Set<number> = ((globalThis as Record<symbol, unknown>)[Symbol.for("codedetails.testOwnedPorts")] ??= new Set<number>()) as Set<number>;

function target(args: unknown[]): { host?: string; port?: number; path?: string } {
  // net.connect() and fetch hand Socket#connect one already-normalized array
  // ([options, callback]); unwrap it (Phase C found this form slipped through).
  if (Array.isArray(args[0])) return target(args[0] as unknown[]);
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
  if (t.path || !t.host || !ALLOWED_HOSTS.has(t.host) || !(ALLOWED_PORTS.has(t.port!) || TEST_OWNED_PORTS.has(t.port!))) {
    const where = t.path ?? `${t.host}:${t.port}`;
    throw new IsolationError([`outbound connection to ${where} refused; only 127.0.0.1:${TEST_DB_PORT}, :${TEST_CONVEX_PORT} and :${TEST_CONVEX_SITE_PORT} are allowed`]);
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
