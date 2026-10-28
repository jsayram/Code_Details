import { connectTestDb } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";

// Loads the synthetic fixtures into the isolated test database for the run.
export default async function globalSetup() {
  const sql = await connectTestDb();
  try {
    await cleanupFixtures(sql);
    await loadFixtures(sql, generateFixtures());
  } finally {
    await sql.end();
  }
}
