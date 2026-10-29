// SEC-D08-RL on the task-owned test backend. Server-to-server auth calls carry
// no client IP, so Better Auth used to put them all into one "no-trusted-ip"
// bucket (100 per 60 s): Convex's JWKS fetches for token checks, and the
// Next.js server's token calls. Once full, signed-in users read as signed out.
// Now: Convex has the static JWKS (no fetch), /convex/jwks is exempt (public
// keys only), and /convex/token skips the limiter only with the server's
// internal secret. Public endpoints keep their limits, secret or not.
import fs from "node:fs";
import path from "node:path";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearConvexFixtures, convexAvailable } from "../fixtures/convex";
import { SYNTHETIC_PASSWORD, clientWithToken, convexToken, signUp, syntheticEmail, type Jar } from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";
import { RUNTIME_DIR } from "../support/test-db";

const SECRET_FILE = path.join(RUNTIME_DIR, "convex", "internal-auth-secret");
const JWKS_FILE = path.join(RUNTIME_DIR, "convex", "jwks.json");
const HEADER = "x-codedetails-internal-auth";
const whoami = makeFunctionReference<"query", Record<string, never>, { role: string } | null>("identity:whoami");
const secret = () => fs.readFileSync(SECRET_FILE, "utf8").trim();
const cookie = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** A token call the way the Next.js server makes it: cookie only (no client IP), plus whatever extra headers. */
const serverTokenCall = (jar: Jar, extra: Record<string, string> = {}) =>
  fetch(`${TEST_CONVEX_SITE_URL}/api/auth/convex/token`, { headers: { cookie: cookie(jar), ...extra } });

describe.skipIf(!convexAvailable() || !fs.existsSync(SECRET_FILE))("SEC-D08-RL shared rate-limit bucket", () => {
  let jar: Jar;
  beforeAll(async () => {
    await clearConvexFixtures();
    const res = await signUp(syntheticEmail("rl"), SYNTHETIC_PASSWORD);
    expect(res.status).toBe(200);
    jar = res.jar;
  }, 60_000);
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("the deployment has a static JWKS, so token checks need no fetch", () => {
    const jwks = JSON.parse(fs.readFileSync(JWKS_FILE, "utf8")) as { publicKey?: string }[];
    expect(jwks.length).toBeGreaterThan(0);
    expect(typeof jwks[0].publicKey).toBe("string");
  });

  it("150 token checks in a row all resolve the user (more than the old shared bucket held)", async () => {
    const token = (await convexToken(jar))!;
    const client = clientWithToken(token);
    for (let i = 0; i < 150; i++) expect((await client.query(whoami, {}))?.role, `check ${i}`).toBe("user");
  }, 120_000);

  it("the public keys endpoint is never rate-limited, even without a client IP", async () => {
    for (let i = 0; i < 120; i++) expect((await fetch(`${TEST_CONVEX_SITE_URL}/api/auth/convex/jwks`)).status, `fetch ${i}`).toBe(200);
  }, 120_000);

  it("the server's token calls with the internal secret never hit the limit", async () => {
    for (let i = 0; i < 120; i++) expect((await serverTokenCall(jar, { [HEADER]: secret() })).status, `call ${i}`).toBe(200);
  }, 120_000);

  it("the secret only skips the limiter: without a valid session the call is still refused", async () => {
    const res = await fetch(`${TEST_CONVEX_SITE_URL}/api/auth/convex/token`, { headers: { [HEADER]: secret() } });
    expect(res.status).toBe(401);
  });

  it("token calls without the secret (or with a wrong one) keep the default limit", async () => {
    const ip = "2001:db8:5ec:1::1";
    const statuses: number[] = [];
    for (let i = 0; i < 105; i++) statuses.push((await serverTokenCall(jar, { "x-forwarded-for": ip, [HEADER]: i % 2 ? "wrong-secret-wrong-secret-wrong-secret" : "" })).status);
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(100)).toContain(429);
  }, 120_000);

  it("a flood of a public endpoint is still limited, and the secret doesn't change that", async () => {
    const ip = "2001:db8:5ec:2::1";
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${TEST_CONVEX_SITE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip, [HEADER]: secret() },
        body: JSON.stringify({ email: syntheticEmail("rl-flood"), password: "not-the-password" }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(10);
  }, 120_000);
});
