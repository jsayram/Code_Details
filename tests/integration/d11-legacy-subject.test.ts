// D11 (decision A): identity:legacySubject gives the caller its own
// Clerk-era subject and nothing else, on the task-owned test backend. Clerk-era
// personas are the D01 fixtures; Better Auth logins are real sign-ups, linked
// through the D08d handover HTTP action the way the Next.js route calls it.
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, testIssuerAvailable } from "../fixtures/convex-auth";
import { SYNTHETIC_PASSWORD, clientWithToken, convexToken, signOut, signUp, syntheticEmail } from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL, TEST_CONVEX_URL } from "../support/isolation";

const SECRET_FILE = path.resolve(__dirname, "../../.test-runtime/convex/handover-secret");
const secretAvailable = () => fs.existsSync(SECRET_FILE);
const legacySubject = makeFunctionReference<"query", Record<string, never>, string | null>("identity:legacySubject");
const set = generateFixtures();
const { a: A, b: B } = set.personas;

async function login(label: string) {
  const res = await signUp(syntheticEmail(label), SYNTHETIC_PASSWORD);
  expect(res.status).toBe(200);
  return { jar: res.jar, token: (await convexToken(res.jar))! };
}

async function handover(token: string, clerkSubject: string) {
  const res = await fetch(`${TEST_CONVEX_SITE_URL}/account/handover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-codedetails-handover-secret": fs.readFileSync(SECRET_FILE, "utf8").trim() },
    body: JSON.stringify({ clerkSubject }),
  });
  expect(res.status).toBe(200);
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable() || !secretAvailable())("D11 identity:legacySubject", () => {
  beforeEach(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });
  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("a handed-over Better Auth login gets exactly its own Clerk-era subject; A's token never gets B's", async () => {
    const a = await login("d11-a");
    const b = await login("d11-b");
    await handover(a.token, A.subject!);
    await handover(b.token, B.subject!);
    expect(await clientWithToken(a.token).query(legacySubject, {})).toBe(A.subject);
    expect(await clientWithToken(b.token).query(legacySubject, {})).toBe(B.subject);
    expect(A.subject).not.toBe(B.subject);
  });

  it("an account with no Clerk-era link gets null", async () => {
    const fresh = await login("d11-fresh");
    expect(await clientWithToken(fresh.token).query(legacySubject, {})).toBeNull();
  });

  it("anonymous callers get null", async () => {
    expect(await new ConvexHttpClient(TEST_CONVEX_URL).query(legacySubject, {})).toBeNull();
  });

  it("a signed-out session's token gets null (getViewer refuses it)", async () => {
    const a = await login("d11-signed-out");
    await handover(a.token, A.subject!);
    expect(await clientWithToken(a.token).query(legacySubject, {})).toBe(A.subject);
    await signOut(a.jar);
    expect(await clientWithToken(a.token).query(legacySubject, {})).toBeNull();
  });

  it("a deleting Clerk-era account gets null", async () => {
    expect(await clientAs(set.personas.deleting.subject!).query(legacySubject, {})).toBeNull();
  });

  it("a Clerk-era synthetic token gets only its own subject", async () => {
    expect(await clientAs(A.subject!).query(legacySubject, {})).toBe(A.subject);
    expect(await clientAs(B.subject!).query(legacySubject, {})).toBe(B.subject);
  });
});
