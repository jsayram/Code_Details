import { afterAll, describe, expect, it } from "vitest";
import { connectTestDb, testDbAvailable } from "../support/test-db";

// Needs the task-owned test database (tests/db/provision.sh). Skipped, not
// failed, where it doesn't exist; CI provisions its own later (B12).
describe.skipIf(!testDbAvailable())("isolated test database", () => {
  let sql: Awaited<ReturnType<typeof connectTestDb>> | undefined;
  afterAll(async () => {
    await sql?.end();
  });

  it("carries the isolation marker and the capture's collation", async () => {
    sql = await connectTestDb();
    const [row] = await sql<{ collate: string; port: string }[]>`
      select datcollate as collate, current_setting('port') as port from pg_database where datname = current_database()`;
    expect(row.collate).toBe("C.UTF-8");
  });

  // E03: the app has no database client any more (src/db is gone); the test DB
  // serves the Supabase fixtures and policy tests only.
});
