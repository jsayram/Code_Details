// Preloaded into every Node process of the test Next server (via NODE_OPTIONS).
// Refuses sockets to anything but loopback, and to the development Supabase
// ports even on loopback, so the server can't reach Clerk, Stripe, an LLM
// provider or the development database whatever the app code tries.
import net from "node:net";

const FORBIDDEN_PORTS = new Set([54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54329]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function target(args) {
  // net.connect() and fetch hand Socket#connect one already-normalized array
  // ([options, callback]). Unwrap it: before Phase C this form fell through to
  // host "localhost" and was allowed whatever the real destination was.
  if (Array.isArray(args[0])) return target(args[0]);
  const [first, second] = args;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    return { host: first.host ?? "localhost", port: first.port === undefined ? undefined : Number(first.port), path: first.path };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { path: first };
  return { port: Number(first), host: typeof second === "string" ? second : "localhost" };
}

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const t = target(args);
  // Unix sockets and pipes stay on this machine (Next's own workers use them).
  if (!t.path && (!LOOPBACK.has(t.host) || !Number.isInteger(t.port) || FORBIDDEN_PORTS.has(t.port))) {
    const err = new Error(`[test isolation] outbound connection to ${t.host}:${t.port} refused`);
    err.code = "ECONNREFUSED";
    process.emitWarning(err.message);
    throw err;
  }
  return original.apply(this, args);
};
