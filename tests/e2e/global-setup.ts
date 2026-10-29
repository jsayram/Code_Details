import { connectTestDb } from "../support/test-db";
import { generateFixtures } from "../fixtures/generate";
import { cleanupFixtures, loadFixtures } from "../fixtures/supabase";
import { clearConvexFixtures, loadConvexFixtures } from "../fixtures/convex";

// Loads the synthetic fixtures into the isolated test database (and, in
// Convex read mode or Better Auth mode, the local Convex backend) for the run.
export default async function globalSetup() {
  const sql = await connectTestDb();
  try {
    await cleanupFixtures(sql);
    await loadFixtures(sql, generateFixtures());
    // Convex mode (Phase C): the same fixtures in the local Convex backend.
    // D08h: Better Auth mode too, so its runs always start with the D01
    // personas loaded, whatever ran on the shared backend before (npm test's
    // integration tests clear it).
    if (process.env.CODEDETAILS_E2E_READ_BACKEND === "convex" || process.env.CODEDETAILS_E2E_AUTH_BACKEND === "better-auth") {
      await clearConvexFixtures();
      await loadConvexFixtures(generateFixtures());
    }
  } finally {
    await sql.end();
  }
}
