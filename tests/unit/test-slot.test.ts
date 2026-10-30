// Test slots (tests/support/slot.cjs): CODEDETAILS_TEST_SLOT moves the whole
// harness to its own ports so several worktrees can run the suites at once.
// Slot 0 must stay exactly the original layout, no slot may land on a port
// that holds real data, and the guards must open only the active slot's ports.
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE,
  MAX_SLOT,
  NEVER_TEST_PORTS,
  assertSlotPortsSafe,
  otherSlotPorts,
  parseSlot,
  slotConfig,
} from "../support/slot.cjs";
import {
  IsolationError,
  TEST_CONVEX_PORT,
  TEST_CONVEX_SITE_PORT,
  TEST_CONVEX_SITE_URL,
  TEST_CONVEX_URL,
  TEST_DB_PORT,
  isolatedEnv,
  isolationProblems,
} from "../support/isolation";
import { RUNTIME_DIR } from "../support/test-db";
import { REFUSED_PORTS } from "../support/slot-net-guard.cjs";

const root = path.resolve(__dirname, "../..");
const slots = Array.from({ length: MAX_SLOT + 1 }, (_, n) => n);

describe("slot to port mapping", () => {
  it("slot 0 is the original layout", () => {
    expect(slotConfig(0)).toEqual({
      slot: 0,
      convexPort: 3210,
      convexSitePort: 3211,
      dbPort: 55432,
      nextPort: 3100,
      mailPort: 3299,
      dbContainer: "codedetails-phaseb-testdb",
      convexInstance: "codedetails-phase-c",
      runtimeDir: ".test-runtime",
    });
  });

  it.each(slots.slice(1))("slot %i gets its own ports, names and state folder", (n) => {
    expect(slotConfig(n)).toEqual({
      slot: n,
      convexPort: 3300 + 10 * n,
      convexSitePort: 3301 + 10 * n,
      dbPort: 55432 + n,
      nextPort: 3100 + n,
      mailPort: 3302 + 10 * n,
      dbContainer: `codedetails-phaseb-testdb-slot${n}`,
      convexInstance: `codedetails-phase-c-slot${n}`,
      runtimeDir: `.test-runtime/slot-${n}`,
    });
  });

  it("slot 1 is the table in the docs", () => {
    expect(slotConfig(1)).toMatchObject({ convexPort: 3310, convexSitePort: 3311, dbPort: 55433, nextPort: 3101 });
  });

  it("no two slots share a port, and none uses a forbidden one", () => {
    const seen = new Map<number, number>();
    for (const n of slots) {
      const c = slotConfig(n);
      for (const port of [c.convexPort, c.convexSitePort, c.dbPort, c.nextPort, c.mailPort]) {
        expect(NEVER_TEST_PORTS).not.toContain(port);
        expect(seen.get(port), `port ${port} of slot ${n}`).toBeUndefined();
        seen.set(port, n);
      }
    }
  });

  it("parses CODEDETAILS_TEST_SLOT: unset or empty is 0, otherwise an integer 0-9", () => {
    expect(parseSlot(undefined)).toBe(0);
    expect(parseSlot("")).toBe(0);
    expect(parseSlot("0")).toBe(0);
    expect(parseSlot("1")).toBe(1);
    expect(parseSlot("9")).toBe(9);
    for (const bad of ["10", "-1", "1.5", "one", " 1", "0x1"]) expect(() => parseSlot(bad), bad).toThrow(/CODEDETAILS_TEST_SLOT/);
    expect(() => slotConfig(10)).toThrow();
  });

  it("the shell form matches the module, so the scripts and the harness agree", () => {
    const r = spawnSync(process.execPath, [path.join(root, "tests/support/slot.cjs"), "--shell"], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", CODEDETAILS_TEST_SLOT: "3" },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("SLOT_CONVEX_PORT=3330\n");
    expect(r.stdout).toContain("SLOT_CONVEX_SITE_PORT=3331\n");
    expect(r.stdout).toContain("SLOT_DB_PORT=55435\n");
    expect(r.stdout).toContain("SLOT_DB_CONTAINER=codedetails-phaseb-testdb-slot3\n");
    expect(r.stdout).toContain("SLOT_RUNTIME_DIR=.test-runtime/slot-3\n");
    const bad = spawnSync(process.execPath, [path.join(root, "tests/support/slot.cjs"), "--shell"], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", CODEDETAILS_TEST_SLOT: "12" },
      encoding: "utf8",
    });
    expect(bad.status).not.toBe(0);
    expect(bad.stdout).toBe("");
  });
});

describe("forbidden ports", () => {
  it("covers the dev server, the import, manual and dev backends and the dev Supabase", () => {
    for (const port of [3000, 3220, 3221, 3230, 3231, 3240, 3241, 54321, 54322]) expect(NEVER_TEST_PORTS).toContain(port);
  });

  it.each([3000, 3220, 3221, 3230, 3231, 3240, 3241, 54321, 54322])("refuses a slot whose ports would include %i", (port) => {
    const ports = { slot: 7, convexPort: 3370, convexSitePort: port, dbPort: 55439, nextPort: 3107, mailPort: 3372 };
    expect(() => assertSlotPortsSafe(ports)).toThrow(new RegExp(`convexSitePort would be ${port}`));
  });
});

describe("guards follow the active slot", () => {
  it("the harness constants are the active slot's", () => {
    expect([TEST_DB_PORT, TEST_CONVEX_PORT, TEST_CONVEX_SITE_PORT]).toEqual([ACTIVE.dbPort, ACTIVE.convexPort, ACTIVE.convexSitePort]);
    expect(TEST_CONVEX_URL).toBe(`http://127.0.0.1:${ACTIVE.convexPort}`);
    expect(TEST_CONVEX_SITE_URL).toBe(`http://127.0.0.1:${ACTIVE.convexSitePort}`);
    expect(RUNTIME_DIR).toBe(path.join(root, ACTIVE.runtimeDir));
  });

  it("the worker keeps the slot after its env is replaced, and slot 0 adds no variable", () => {
    expect(process.env.CODEDETAILS_TEST_SLOT ?? "0").toBe(String(ACTIVE.slot));
    if (ACTIVE.slot === 0) expect(isolatedEnv()).not.toHaveProperty("CODEDETAILS_TEST_SLOT");
    else expect(isolatedEnv().CODEDETAILS_TEST_SLOT).toBe(String(ACTIVE.slot));
  });

  it("the env check refuses another slot's database, backend or slot number", () => {
    const other = slotConfig(ACTIVE.slot === 0 ? 1 : 0);
    const env = isolatedEnv({}, "pw");
    expect(isolationProblems({ ...env, DATABASE_URL: `postgresql://postgres:pw@127.0.0.1:${other.dbPort}/postgres` }).join()).toMatch(
      new RegExp(`DATABASE_URL must use port ${ACTIVE.dbPort}`),
    );
    expect(isolationProblems({ ...env, CODEDETAILS_CONVEX_URL: `http://127.0.0.1:${other.convexPort}` }).join()).toMatch(/CODEDETAILS_CONVEX_URL must be/);
    expect(isolationProblems({ ...env, CODEDETAILS_CONVEX_SITE_URL: `http://127.0.0.1:${other.convexSitePort}` }).join()).toMatch(
      /CODEDETAILS_CONVEX_SITE_URL must be/,
    );
    expect(isolationProblems({ ...env, CODEDETAILS_TEST_SLOT: String(other.slot) }).join()).toMatch(/CODEDETAILS_TEST_SLOT must match/);
  });

  it.each(otherSlotPorts(ACTIVE.slot))("the Vitest socket guard refuses other slots' port %i", (port) => {
    expect(() => net.connect({ port, host: "127.0.0.1" })).toThrow(IsolationError);
  });

  it("otherSlotPorts leaves out exactly the slot's own ports", () => {
    for (const n of slots) {
      const c = slotConfig(n);
      const others = otherSlotPorts(n);
      for (const own of [c.convexPort, c.convexSitePort, c.dbPort, c.nextPort, c.mailPort]) expect(others).not.toContain(own);
      expect(others).toHaveLength(5 * MAX_SLOT);
    }
  });

  // The browser-test app server's guard (tests/e2e/server-net-guard.mjs), run
  // in a child with nothing but PATH, the app-server flag and a slot. A stub
  // loaded before the guard replaces the real connect, so an allowed port
  // opens no socket either (slot 0's servers belong to other sessions).
  const INSTALL_GUARD = `data:text/javascript,import { createRequire } from 'node:module';createRequire(${JSON.stringify(path.join(root, "package.json"))})('./tests/support/slot-net-guard.cjs').installSlotNetGuard()`;
  const NO_CONNECT = "data:text/javascript,import net from 'node:net';net.Socket.prototype.connect=function(){return this}";
  // Which of `ports` a child process refuses, with `preload` loaded after the stub.
  function refusals(preload: string[], env: Record<string, string>, ports: number[]): number[] {
    const script = `const net=require("node:net");const out=[];for(const p of ${JSON.stringify(ports)}){try{new net.Socket().connect({port:p,host:"127.0.0.1"})}catch{out.push(p)}}process.stdout.write(JSON.stringify(out))`;
    const r = spawnSync(process.execPath, ["--no-warnings", "--import", NO_CONNECT, ...preload, "-e", script], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...env },
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as number[];
  }
  const serverGuard = ["--import", path.join(root, "tests/e2e/server-net-guard.mjs")];
  const portsOf = (n: number) => {
    const c = slotConfig(n);
    return [c.convexPort, c.convexSitePort, c.dbPort, c.nextPort, c.mailPort];
  };

  it.each([0, 1, 9])("the app server guard in slot %i refuses forbidden and other slots' ports, and allows its own", (n) => {
    const others = otherSlotPorts(n);
    const refused = refusals(serverGuard, { CODEDETAILS_NET_GUARD_APP_SERVER: "1", CODEDETAILS_TEST_SLOT: String(n) }, [...NEVER_TEST_PORTS, ...others, ...portsOf(n)]);
    expect(refused).toEqual([...NEVER_TEST_PORTS, ...others]);
  });

  it("with slot 1, the push/importer guard refuses slot 0's ports too", () => {
    expect(refusals(serverGuard, { CODEDETAILS_TEST_SLOT: "1" }, [...portsOf(0), ...portsOf(1)])).toEqual(portsOf(0));
  });

  it.each([0, 1, 9])("the Playwright runner and worker guard in slot %i refuses forbidden and other slots' ports, and allows its own", (n) => {
    const others = otherSlotPorts(n);
    // INSTALL_GUARD calls installSlotNetGuard() the way playwright.config.ts does.
    const refused = refusals(["--import", INSTALL_GUARD], { CODEDETAILS_TEST_SLOT: String(n) }, [...NEVER_TEST_PORTS, ...others, ...portsOf(n)]);
    expect(refused).toEqual([...NEVER_TEST_PORTS, ...others]);
  });

  it("with CODEDETAILS_TEST_SLOT=1, slot 0's Next, Convex, site, database and mail ports are all refused", () => {
    expect(portsOf(0)).toEqual([3210, 3211, 55432, 3100, 3299]);
    const refused = refusals(["--import", INSTALL_GUARD], { CODEDETAILS_TEST_SLOT: "1" }, portsOf(0));
    expect(refused).toEqual(portsOf(0));
    expect(REFUSED_PORTS).toEqual([...new Set([...NEVER_TEST_PORTS, ...otherSlotPorts(ACTIVE.slot)])].sort((a, b) => a - b));
  });
});
