// D08g4 flip-on: the dev-app Convex backend (scripts/dev-backend/) is local
// only, on its own reserved ports, keeps its state in the main checkout, and
// gets none of the test-only switches when pushed.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NEVER_TEST_PORTS } from "../support/slot.cjs";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("dev-app Convex backend", () => {
  const up = read("scripts/dev-backend/backend-up.sh");
  const down = read("scripts/dev-backend/backend-down.sh");
  const push = read("tests/convex/push.mjs");

  it("binds loopback only, on 3240/3241, beacon off", () => {
    expect(up).toMatch(/^PORT=3240$/m);
    expect(up).toMatch(/^SITE_PORT=3241$/m);
    expect(up).toContain("--interface 127.0.0.1");
    expect(up).toContain("--disable-beacon");
  });

  it("no test slot may use its ports", () => {
    expect(NEVER_TEST_PORTS).toEqual(expect.arrayContaining([3240, 3241]));
  });

  it("keeps state in the main checkout, and --wipe removes only that", () => {
    for (const script of [up, down]) {
      expect(script).toContain('MAIN="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)/.." && pwd)"');
      expect(script).toContain('STATE="$MAIN/.test-runtime/convex-dev"');
    }
    expect(down).toContain('rm -rf "${STATE:?}" "${MAIN:?}/.test-runtime/convex-dev.env"');
  });

  it("the push target sets its login env and no test-only switch", () => {
    const dev = push.slice(push.indexOf('if (target === "dev") {'), push.indexOf("let res = { status: 0 };"));
    for (const name of ["BETTER_AUTH_SECRET", "SITE_URL", "CODEDETAILS_INTERNAL_AUTH_SECRET", "CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION"]) {
      expect(dev).toContain(`"${name}"`);
    }
    // No test-only value, and no *_ALLOWED flag (fixtures, import, purge, sweep;
    // d06-image-sweep-rules pins that the sweep flag is set for the test target only).
    expect(dev).not.toMatch(/TEST_CLIENT_IP|SYNTHETIC|GITHUB_|_ALLOWED/);
    expect(push).toMatch(/dev: \{ envFile: [^}]*port: "3240"[^}]*allow: null \}/);
  });
});
