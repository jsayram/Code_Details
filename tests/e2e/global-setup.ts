import { connectTestDb } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { clearConvexFixtures, loadConvexFixtures } from "../fixtures/convex";

// Loads the synthetic fixtures into the isolated test database (and, in
// Convex mode, the local Convex backend) for the run.
export default async function globalSetup() {
  const sql = await connectTestDb();
  try {
    await cleanupFixtures(sql);
    await loadFixtures(sql, generateFixtures());
    // Convex mode (Phase C): the same fixtures in the local Convex backend.
    if (process.env.CODEDETAILS_E2E_READ_BACKEND === "convex") {
      await clearConvexFixtures();
      await loadConvexFixtures(generateFixtures());
    }
  } finally {
    await sql.end();
  }
}
