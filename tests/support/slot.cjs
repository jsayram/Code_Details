// Test slots: lets several worktrees run the suites at once, each on its own
// ports. CODEDETAILS_TEST_SLOT picks the slot (an integer 0-9, default 0).
// Slot 0 is the original layout (Convex 3210/3211, test DB 55432, Next 3100,
// fake mail 3299, container codedetails-phaseb-testdb, state in .test-runtime/).
// Slot n (1-9) moves everything to its own ports, names and state folder.
//
// Plain CommonJS so the shell scripts (`node tests/support/slot.cjs --shell`),
// the .mjs launchers and the TypeScript harness all read one mapping.
"use strict";

/**
 * Ports no slot may ever use: the normal dev server (3000), the D00b import
 * backend holding real data (3220/3221), the manual-check backend (3230/3231)
 * and the development Supabase range (54320-54329).
 * @type {readonly number[]}
 */
const NEVER_TEST_PORTS = Object.freeze([3000, 3220, 3221, 3230, 3231, 54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54329]);

const MAX_SLOT = 9;

/**
 * Parses CODEDETAILS_TEST_SLOT. Unset or empty means 0; anything else must be an integer 0-9.
 * @param {string | undefined} value
 * @returns {number}
 */
function parseSlot(value) {
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value) || Number(value) > MAX_SLOT) {
    throw new Error(`CODEDETAILS_TEST_SLOT must be an integer from 0 to ${MAX_SLOT}, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

/**
 * Throws if any port of the slot is one of NEVER_TEST_PORTS.
 * @template {{ slot: number }} T
 * @param {T} ports
 * @returns {T}
 */
function assertSlotPortsSafe(ports) {
  for (const [name, port] of Object.entries(ports)) {
    if (name !== "slot" && typeof port === "number" && NEVER_TEST_PORTS.includes(port)) {
      throw new Error(`test slot ${ports.slot}: ${name} would be ${port}, a port tests must never use`);
    }
  }
  return ports;
}

/**
 * Everything that differs between slots. `runtimeDir` is relative to the
 * worktree root.
 * @param {number} slot
 */
function slotConfig(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) throw new Error(`test slot must be 0-${MAX_SLOT}, got ${slot}`);
  const ports =
    slot === 0
      ? { slot, convexPort: 3210, convexSitePort: 3211, dbPort: 55432, nextPort: 3100, mailPort: 3299 }
      : { slot, convexPort: 3300 + 10 * slot, convexSitePort: 3301 + 10 * slot, dbPort: 55432 + slot, nextPort: 3100 + slot, mailPort: 3302 + 10 * slot };
  assertSlotPortsSafe(ports);
  const suffix = slot === 0 ? "" : `-slot${slot}`;
  return Object.freeze({
    ...ports,
    dbContainer: `codedetails-phaseb-testdb${suffix}`,
    convexInstance: `codedetails-phase-c${suffix}`,
    runtimeDir: slot === 0 ? ".test-runtime" : `.test-runtime/slot-${slot}`,
  });
}

/**
 * Ports that belong to every slot except `slot`: what that slot's processes must not reach.
 * @param {number} slot
 * @returns {number[]}
 */
function otherSlotPorts(slot) {
  /** @param {ReturnType<typeof slotConfig>} c */
  const portsOf = (c) => [c.convexPort, c.convexSitePort, c.dbPort, c.nextPort, c.mailPort];
  const own = new Set(portsOf(slotConfig(slot)));
  const others = new Set();
  for (let n = 0; n <= MAX_SLOT; n++) for (const p of portsOf(slotConfig(n))) if (!own.has(p)) others.add(p);
  return [...others].sort((a, b) => a - b);
}

const ACTIVE_SLOT = parseSlot(process.env.CODEDETAILS_TEST_SLOT);
const ACTIVE = slotConfig(ACTIVE_SLOT);

module.exports = { NEVER_TEST_PORTS, MAX_SLOT, parseSlot, assertSlotPortsSafe, slotConfig, otherSlotPorts, ACTIVE_SLOT, ACTIVE };

// `node tests/support/slot.cjs --shell` prints the active slot as shell
// assignments for tests/convex/*.sh and tests/db/*.sh.
if (require.main === module && process.argv[2] === "--shell") {
  const a = ACTIVE;
  process.stdout.write(
    [
      `SLOT=${a.slot}`,
      `SLOT_CONVEX_PORT=${a.convexPort}`,
      `SLOT_CONVEX_SITE_PORT=${a.convexSitePort}`,
      `SLOT_DB_PORT=${a.dbPort}`,
      `SLOT_NEXT_PORT=${a.nextPort}`,
      `SLOT_DB_CONTAINER=${a.dbContainer}`,
      `SLOT_CONVEX_INSTANCE=${a.convexInstance}`,
      `SLOT_RUNTIME_DIR=${a.runtimeDir}`,
    ].join("\n") + "\n",
  );
}
