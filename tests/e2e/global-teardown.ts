import fs from "node:fs";
import path from "node:path";
import { connectTestDb } from "../support/test-db";
import { cleanupFixtures } from "../fixtures/supabase";
import { clearConvexFixtures } from "../fixtures/convex";

// next dev rewrites the tracked next-env.d.ts to point at .next-test, and
// Playwright stops the server too abruptly for the launcher to undo it.
function restoreNextEnv() {
  const file = path.resolve(__dirname, "../../next-env.d.ts");
  const text = fs.readFileSync(file, "utf8");
  if (text.includes(".next-test/")) fs.writeFileSync(file, text.replaceAll(".next-test/", ".next/"));
}

export default async function globalTeardown() {
  restoreNextEnv();
  const sql = await connectTestDb();
  try {
    await cleanupFixtures(sql);
    await clearConvexFixtures();
  } finally {
    await sql.end();
  }
}
