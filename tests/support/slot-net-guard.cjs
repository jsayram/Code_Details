// Socket guard for the Playwright runner and its workers (test slots,
// tests/support/slot.cjs). playwright.config.ts installs it, and Playwright
// loads that config in the runner and in every worker, so fixture code
// (database, Convex, Better Auth requests) can't reach another slot's servers
// or a port that holds real data. The browser is held to the test server by
// the route allowlist in tests/e2e/support.ts.
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS module (playwright.config.ts loads it in every worker) */
const net = require("node:net");
const { ACTIVE, NEVER_TEST_PORTS, otherSlotPorts } = require("./slot.cjs");

const REFUSED = new Set([...NEVER_TEST_PORTS, ...otherSlotPorts(ACTIVE.slot)]);
const INSTALLED = Symbol.for("codedetails.slotNetGuard");

/** @param {unknown[]} args */
function targetPort(args) {
  if (Array.isArray(args[0])) return targetPort(args[0]);
  const first = args[0];
  if (first && typeof first === "object") {
    const port = /** @type {{ port?: number | string }} */ (first).port;
    return port === undefined ? undefined : Number(port);
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return undefined; // a unix socket path
  return Number(first);
}

function installSlotNetGuard() {
  const proto = /** @type {any} */ (net.Socket.prototype);
  if (proto[INSTALLED]) return;
  const original = proto.connect;
  proto.connect = function guardedConnect(/** @type {unknown[]} */ ...args) {
    const port = targetPort(args);
    if (port !== undefined && REFUSED.has(port)) {
      const err = /** @type {Error & { code?: string }} */ (new Error(`[test slot ${ACTIVE.slot}] connection to port ${port} refused: it belongs to another slot or holds real data`));
      err.code = "ECONNREFUSED";
      throw err;
    }
    return original.apply(this, args);
  };
  proto[INSTALLED] = true;
}

module.exports = { installSlotNetGuard, REFUSED_PORTS: [...REFUSED].sort((a, b) => a - b) };
