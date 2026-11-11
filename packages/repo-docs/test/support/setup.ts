// Runs before each package test file under the package's own vitest config.
// No test may open a socket except to a loopback port it registered with
// allowTestOwnedPort, so nothing here can reach GitHub, a model provider or
// the network by accident. Provider keys and the GitHub token are cleared.
import net from "node:net";

for (const name of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET)$/.test(name) || name === "AZURE_OPENAI_ENDPOINT") delete process.env[name];
}

const owned = () =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for("codedetails.testOwnedPorts")] ??= new Set<number>()) as Set<number>;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function target(args: unknown[]): { host?: string; port?: number; path?: string } {
  if (Array.isArray(args[0])) return target(args[0] as unknown[]);
  const [first, second] = args;
  if (first && typeof first === "object") {
    const o = first as { host?: string; port?: number | string; path?: string };
    return { host: o.host ?? "localhost", port: o.port === undefined ? undefined : Number(o.port), path: o.path };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { path: first };
  return { port: Number(first), host: typeof second === "string" ? second : "localhost" };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  const t = target(args);
  if (t.path || !t.host || !LOOPBACK.has(t.host) || !owned().has(t.port!)) {
    throw new Error(`repo-docs tests: outbound connection to ${t.path ?? `${t.host}:${t.port}`} refused`);
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
