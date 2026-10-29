// SEC-D08-XFF (interim, fail closed) on the task-owned test backend, which has
// no trusted-proxy list: X-Forwarded-For is ignored, so rotating it never buys
// a fresh rate-limit bucket. Clients without the test-only header share the
// fallback bucket; with it, each test client keeps its own (as before).
import { describe, expect, it } from "vitest";
import { convexAvailable } from "../fixtures/convex";
import { TEST_CLIENT_IP_HEADER, freshClientIp, syntheticEmail } from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";

let n = 0;
const rotated = () => `203.0.113.${(++n % 250) + 1}`;

async function signInAttempt(headers: Record<string, string>) {
  const res = await fetch(`${TEST_CONVEX_SITE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify({ email: syntheticEmail("xff"), password: "not-the-password" }),
  });
  return res.status;
}

describe.skipIf(!convexAvailable())("SEC-D08-XFF containment", () => {
  it("a new X-Forwarded-For on every attempt doesn't get a fresh bucket (no test header: the shared fallback)", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push(await signInAttempt({ "x-forwarded-for": rotated(), "x-real-ip": rotated() }));
    expect(codes).toContain(429);
  }, 60_000);

  it("with the test header, rotating X-Forwarded-For still doesn't help: the limit follows the test client", async () => {
    const ip = freshClientIp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push(await signInAttempt({ [TEST_CLIENT_IP_HEADER]: ip, "x-forwarded-for": rotated() }));
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // Another test client is unaffected.
    expect(await signInAttempt({ [TEST_CLIENT_IP_HEADER]: freshClientIp() })).toBe(401);
  }, 60_000);
});
