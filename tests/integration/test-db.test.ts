import { afterAll, describe, expect, it } from "vitest";
import { TEST_DB_PORT } from "../support/isolation";
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

  it("is what the app's own database client connects to", async () => {
    expect(new URL(process.env.DATABASE_URL!).port).toBe(String(TEST_DB_PORT));
    // Imported lazily: src/db/server.ts throws at import when DATABASE_URL is unset.
    const { executeQuery } = await import("../../src/db/server.js");
    const { tags } = await import("../../src/db/schema/tags.js");
    const rows = await executeQuery((db) => db.select({ id: tags.id }).from(tags).limit(1));
    expect(Array.isArray(rows)).toBe(true);
  });
});
