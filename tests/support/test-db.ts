// Connection to the task-owned test database created by tests/db/provision.sh.
// The throwaway password lives in .test-runtime/test-db.json (ignored, mode 600)
// and is regenerated whenever the container is recreated.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { IsolationError, TEST_DB_NAME, TEST_DB_PORT } from "./isolation";
import { ACTIVE } from "./slot.cjs";

/** The active test slot's state folder: .test-runtime/ for slot 0, .test-runtime/slot-<n>/ otherwise. */
export const RUNTIME_DIR = path.resolve(__dirname, "../..", ACTIVE.runtimeDir);
export const TEST_DB_FILE = path.join(RUNTIME_DIR, "test-db.json");
/** Value provision.sh writes into codedetails_test.marker. */
export const MARKER = "codedetails-phase-b-isolated";

export function readTestDbPassword(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(TEST_DB_FILE, "utf8")) as { password: string }).password;
  } catch {
    return null;
  }
}

export function testDbAvailable(): boolean {
  return readTestDbPassword() !== null;
}

/**
 * Opens a connection and refuses to hand it out unless the target carries the
 * isolation marker. A database on the right port without the marker is not ours.
 * `owner` connects as supabase_admin (same throwaway password, same container),
 * for policy DDL on the tables it owns; use it only inside a rolled-back transaction.
 */
export async function connectTestDb({ owner = false } = {}): Promise<postgres.Sql> {
  const password = readTestDbPassword();
  if (!password) throw new IsolationError(["no test database: run tests/db/provision.sh first"]);
  const sql = postgres({
    host: "127.0.0.1",
    port: TEST_DB_PORT,
    database: TEST_DB_NAME,
    username: owner ? "supabase_admin" : "postgres",
    password,
    max: 2,
    onnotice: () => {},
  });
  try {
    const rows = await sql<{ value: string }[]>`select value from codedetails_test.marker`;
    if (rows[0]?.value !== MARKER) throw new IsolationError(["test database marker missing or wrong"]);
  } catch (error) {
    await sql.end();
    if (error instanceof IsolationError) throw error;
    throw new IsolationError([`test database marker check failed: ${(error as Error).message}`]);
  }
  return sql;
}
