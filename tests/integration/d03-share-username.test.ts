// D03 (SEC-D03-EMAIL): no callable action hands out a user's email by ID. The
// share button gets only the session's own username.
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();
// Every email field in an answer (owner_email_address, email_address, nested
// profile). Legacy usernames that are email-shaped are a separate, known case.
const emails = (value: unknown): string[] =>
  JSON.stringify(value)
    .match(/"(?:owner_)?email_address":"[^"]*"/g) ?? [];
const A = set.personas.a;
const B = set.personas.b;

describe.skipIf(!testDbAvailable())("SEC-D03-EMAIL", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await connectTestDb();
  });
  beforeEach(async () => {
    signInAs(null);
    await cleanupFixtures(sql);
    await loadFixtures(sql, set);
  });
  afterAll(async () => {
    await cleanupFixtures(sql);
    await sql.end();
  });

  it("the user-by-ID profile lookups are no longer \"use server\" exports", async () => {
    const dbActions = (await import("../../src/db/actions.js")) as Record<string, unknown>;
    expect(dbActions.getUserById).toBeUndefined();
    expect(dbActions.getCachedUserById).toBeUndefined();
  });

  // D04a removed both callable exports (they also carried owner subjects and
  // tiers); d04a-public-profile.test.ts checks they're gone and that the
  // server-only replacement stays clean.
  it("the all-projects reads are no longer callable exports", async () => {
    const dbActions = (await import("../../src/db/actions.js")) as Record<string, unknown>;
    const actions = (await import("../../src/app/actions/projects.js")) as Record<string, unknown>;
    expect(dbActions.getAccessibleProjectsServer).toBeUndefined();
    expect(actions.getAllProjects).toBeUndefined();
  });

  it("readAllActiveProjects (server-only) returns no owner email", async () => {
    const { readAllActiveProjects } = await import("../../src/db/project-read.js");
    const rows = await readAllActiveProjects();
    expect(rows.length).toBeGreaterThan(0);
    expect(emails(rows)).toEqual([]);
  });

  it("the share action answers with the session's own username only", async () => {
    const { getMyShareUsername } = await import("../../src/app/actions/share.js");
    signInAs(A.subject);
    expect(await getMyShareUsername()).toBe(A.profile!.username);
    signInAs(B.subject);
    expect(await getMyShareUsername()).toBe(B.profile!.username);
    signInAs(null);
    expect(await getMyShareUsername()).toBeNull();
  });
});
