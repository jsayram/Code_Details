// SEC-D04-ANALYTICS: the admin analytics in src/app/actions/advanced-analytics.ts
// (a "use server" file) are no longer callable without the admin check. The
// cached versions handed any caller every contributor's provider subject and
// tier and the tag submitters' emails.
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionDouble, nextCacheDouble, signInAs } from "../support/next-doubles";
import { connectTestDb, testDbAvailable } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

vi.mock("@/lib/auth-server", (importOriginal) => sessionDouble(importOriginal));
vi.mock("next/cache", () => nextCacheDouble);

const set = generateFixtures();

describe.skipIf(!testDbAvailable())("SEC-D04-ANALYTICS", () => {
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

  it("the unchecked cached analytics are no longer exported", async () => {
    const mod = (await import("../../src/app/actions/advanced-analytics.js")) as Record<string, unknown>;
    expect(mod.getCachedTopContributors).toBeUndefined();
    expect(mod.getCachedTagPipelineAnalytics).toBeUndefined();
  });

  it("the force-refresh analytics reject a signed-out caller", async () => {
    const { getTopContributors, getTagPipelineAnalytics } = await import("../../src/app/actions/advanced-analytics.js");
    await expect(getTopContributors(10)).rejects.toThrow(/Unauthorized/);
    await expect(getTagPipelineAnalytics()).rejects.toThrow(/Unauthorized/);
  });

  it("the admin-checked versions still answer the admin", async () => {
    signInAs(set.personas.admin.subject, { email: set.personas.admin.profile!.email });
    const { fetchTopContributors } = await import("../../src/app/actions/advanced-analytics.js");
    const rows = await fetchTopContributors(50);
    expect(rows.length).toBeGreaterThan(0);
  });
});
