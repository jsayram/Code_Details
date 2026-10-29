// D08d: Clerk-session handover on the task-owned local backend. The Clerk-era
// personas are the D01 fixtures (clerk authLinks, profiles, usernames); the
// Better Auth side is a real sign-up on 3211. The HTTP action is called the
// way the Next.js route calls it: the user's Better Auth Convex token plus the
// server-only handover secret, with the Clerk subject the server verified.
import fs from "node:fs";
import path from "node:path";
import { makeFunctionReference } from "convex/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateFixtures } from "../fixtures/generate";
import { clearConvexFixtures, convexAvailable, loadConvexFixtures } from "../fixtures/convex";
import { clientAs, signToken, testIssuerAvailable } from "../fixtures/convex-auth";
import {
  SYNTHETIC_PASSWORD,
  accountRows,
  appTablesText,
  authState,
  clientWithToken,
  convexToken,
  setAccountStatus,
  signOut,
  signUp,
  syntheticEmail,
} from "../fixtures/better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";
import { RUNTIME_DIR } from "../support/test-db";

const SECRET_FILE = path.join(RUNTIME_DIR, "convex", "handover-secret");
const secretAvailable = () => fs.existsSync(SECRET_FILE);
const whoami = makeFunctionReference<"query">("identity:whoami");
const set = generateFixtures();
const { a: A, b: B, deleting } = set.personas;

async function handover(clerkSubject: unknown, { token, secret }: { token?: string | null; secret?: string | null }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (secret) headers["x-codedetails-handover-secret"] = secret;
  const res = await fetch(`${TEST_CONVEX_SITE_URL}/account/handover`, { method: "POST", headers, body: JSON.stringify({ clerkSubject }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function freshLogin(label: string) {
  const email = syntheticEmail(label);
  const res = await signUp(email, SYNTHETIC_PASSWORD);
  expect(res.status).toBe(200);
  const state = (await authState(email))!;
  const rows = (await accountRows(state.authUserId))!;
  return { email, jar: res.jar, token: (await convexToken(res.jar))!, authUserId: state.authUserId, handle: rows.profiles[0].username };
}

describe.skipIf(!convexAvailable() || !testIssuerAvailable() || !secretAvailable())("D08d Clerk-session handover", () => {
  const secret = secretAvailable() ? fs.readFileSync(SECRET_FILE, "utf8").trim() : "";

  beforeEach(async () => {
    await clearConvexFixtures();
    await loadConvexFixtures(set);
  });

  afterAll(async () => {
    await clearConvexFixtures();
  });

  it("the Clerk-era account takes over the Better Auth login; the sign-up account goes", async () => {
    const login = await freshLogin("link");
    expect(await clientWithToken(login.token).query(whoami, {})).toMatchObject({ username: login.handle });

    const res = await handover(A.subject, { token: login.token, secret });
    expect(res).toEqual({ status: 200, body: { linked: true, already: false } });

    // The same Better Auth token now resolves to A's existing account.
    expect(await clientWithToken(login.token).query(whoami, {})).toEqual({ username: A.profile!.username, role: "user", tier: A.profile!.tier });
    const rows = (await accountRows(login.authUserId))!;
    expect(rows.profiles.map((p) => p.username)).toEqual([A.profile!.username]);
    const text = await appTablesText();
    expect(text).not.toContain(login.handle);
    // appTablesText order: users, authLinks, profiles, usernames, projects, auditEvents, contentChanges.
    const audit = (JSON.parse(text) as unknown[][])[5] as { kind: string; details?: Record<string, unknown> }[];
    expect(audit).toEqual([expect.objectContaining({ kind: "account.linked", details: { provider: "better-auth", replacedSignUpAccount: true } })]);
    expect(JSON.stringify(audit)).not.toContain(A.subject!);
    expect(JSON.stringify(audit)).not.toContain(login.authUserId);
    // The Clerk-era path still resolves to the same account until D08g.
    expect(await clientAs(A.subject!).query(whoami, {})).toMatchObject({ username: A.profile!.username });
  });

  it("running it again for the same pair changes nothing", async () => {
    const login = await freshLogin("again");
    expect((await handover(A.subject, { token: login.token, secret })).status).toBe(200);
    const before = await appTablesText();
    expect(await handover(A.subject, { token: login.token, secret })).toEqual({ status: 200, body: { linked: true, already: true } });
    expect(await appTablesText()).toBe(before);
  });

  it("an account takes over one Better Auth login only", async () => {
    const first = await freshLogin("first");
    const second = await freshLogin("second");
    expect((await handover(A.subject, { token: first.token, secret })).status).toBe(200);
    expect(await handover(A.subject, { token: second.token, secret })).toEqual({ status: 409, body: { linked: false, reason: "not_linkable" } });
    expect(await clientWithToken(second.token).query(whoami, {})).toMatchObject({ username: second.handle });
  });

  describe("refusals leave everything as it was", () => {
    it.each([
      ["a wrong secret", "x".repeat(43), 403],
      ["no secret", null, 403],
    ])("%s", async (_name, wrong, status) => {
      const login = await freshLogin("secret");
      const before = await appTablesText();
      expect((await handover(A.subject, { token: login.token, secret: wrong })).status).toBe(status);
      expect(await appTablesText()).toBe(before);
    });

    it("no Better Auth token, or one whose session was signed out", async () => {
      const login = await freshLogin("nosession");
      expect((await handover(A.subject, { token: null, secret })).status).toBe(401);
      await signOut(login.jar);
      expect((await handover(A.subject, { token: login.token, secret })).status).toBe(401);
      expect(await clientAs(A.subject!).query(whoami, {})).toMatchObject({ username: A.profile!.username });
    });

    it("a Clerk-era token in place of the Better Auth one", async () => {
      expect((await handover(B.subject, { token: signToken(A.subject!), secret })).status).toBe(401);
    });

    it("an unknown Clerk subject, a deleting account, a malformed subject", async () => {
      const login = await freshLogin("targets");
      expect((await handover("user_fixture_nobody", { token: login.token, secret })).status).toBe(409);
      expect((await handover(deleting.subject, { token: login.token, secret })).status).toBe(409);
      for (const bad of ["not-a-subject", "user_", 42, null, "user_" + "a".repeat(80)]) {
        expect((await handover(bad, { token: login.token, secret })).status).toBe(400);
      }
      expect(await clientWithToken(login.token).query(whoami, {})).toMatchObject({ username: login.handle });
    });

    it("a Better Auth account that already holds more than its sign-up rows", async () => {
      const login = await freshLogin("busy");
      await setAccountStatus(login.authUserId, "deleting");
      expect((await handover(A.subject, { token: login.token, secret })).status).toBe(409);
      expect((await accountRows(login.authUserId))!.profiles.map((p) => p.username)).toEqual([login.handle]);
      expect(await clientAs(A.subject!).query(whoami, {})).toMatchObject({ username: A.profile!.username });
    });
  });
});
