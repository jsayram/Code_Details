// C17: browsing the public project pages writes nothing to either backend.
// Whole-database digests of the isolated test DB (every public table) and of
// the local Convex deployment (every fixture table) are taken before and
// after visiting each fixture page, the 404 path and the interactions, in
// whichever read mode the run uses. Equal digests mean no mixed-provider
// write and no write at all.
import { generateFixtures } from "../fixtures/generate";
import { publicTableDigest } from "../fixtures/supabase";
import { convexDigest } from "../fixtures/convex";
import { connectTestDb } from "../support/test-db";
import { expect, test } from "./support";

const set = generateFixtures();

test("browsing project pages leaves both backends byte-for-byte unchanged", async ({ page }) => {
  const sql = await connectTestDb();
  try {
    const pgBefore = await publicTableDigest(sql);
    const cxBefore = await convexDigest();
    for (const p of set.projects) {
      await page.goto(`/projects/${p.slug}`);
      await page.waitForLoadState("networkidle");
    }
    await page.goto("/projects/fixture-listed");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "View user profile" }).click();
    await page.getByRole("navigation").getByRole("button", { name: "Tags" }).click();
    await page.waitForLoadState("networkidle");
    expect(await publicTableDigest(sql)).toBe(pgBefore);
    expect(await convexDigest()).toBe(cxBefore);
  } finally {
    await sql.end();
  }
});
