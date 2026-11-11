// Preloaded into every Node process of the test Next server (via NODE_OPTIONS).
// Refuses sockets to anything but loopback, and to the development Supabase
// ports even on loopback, so the server can't reach Clerk, Stripe, an LLM
// provider or the development database whatever the app code tries.
import net from "node:net";
import { ACTIVE, NEVER_TEST_PORTS, otherSlotPorts } from "../support/slot.cjs";

const FORBIDDEN_PORTS = new Set([54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54329]);
// D08b: the browser-test app server (start-isolated-server.mjs sets the flag)
// also may not reach the D00b import backend (3220 client, 3221 site). The
// importer and `push.mjs --target import` load this guard too and need 3220.
if (process.env.CODEDETAILS_NET_GUARD_APP_SERVER === "1") {
  for (const p of [3220, 3221]) FORBIDDEN_PORTS.add(p);
  // Test slots (tests/support/slot.cjs): the app server also may not reach the
  // normal dev server or the manual-check backend (below: nor any other slot).
  for (const p of NEVER_TEST_PORTS) FORBIDDEN_PORTS.add(p);
}
// Every process this guard loads into (app server, the Convex CLI under
// push.mjs, the importer) is refused every other test slot's ports.
for (const p of otherSlotPorts(ACTIVE.slot)) FORBIDDEN_PORTS.add(p);
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
