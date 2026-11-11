// D03: the purge's file-deletion retry schedule, and no automatic purge.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILE_DELETE_MAX_ATTEMPTS, LIFECYCLE_BATCH, fileDeleteRetryDelayMs } from "../../src/backend/projects/lifecycle-rules";

describe("D03 lifecycle rules", () => {
  it("file deletes back off exponentially, capped at a minute, for a bounded number of attempts", () => {
    expect([1, 2, 3, 4].map(fileDeleteRetryDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(fileDeleteRetryDelayMs(20)).toBe(60_000);
    expect(FILE_DELETE_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(FILE_DELETE_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  it("the batch bound stays well under Convex's per-transaction write limits", () => {
    expect(LIFECYCLE_BATCH).toBeGreaterThan(0);
    expect(LIFECYCLE_BATCH).toBeLessThanOrEqual(1000);
  });

  // D04d narrowed this to the one automatic purge P07 §5.7 allows: accounts
  // past their 14-day grace period, opt-in per deployment.
  it("no automatic purge: no scheduled job calls the project purge or its batches (P07 §5.11)", () => {
    const crons = fs.readFileSync(path.resolve(__dirname, "../../convex/crons.ts"), "utf8");
    expect(crons).not.toMatch(/projectLifecycle/);
    const purgeLines = crons.split("\n").filter((l) => /purge/i.test(l) && !l.trim().startsWith("//"));
    expect(purgeLines).toHaveLength(1);
    expect(purgeLines[0]).toContain("internal.accountDeletion.purgeDue");
  });

  it("the account purge's entry points do nothing unless the deployment opted in (D04d)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../convex/accountDeletion.ts"), "utf8");
    for (const name of ["purgeDue", "purgeAccountStep"]) {
      const body = src.slice(src.indexOf(`export const ${name} = internalMutation(`));
      const handler = body.slice(body.indexOf("handler:"));
      const firstStatement = handler.slice(handler.indexOf("=> {") + 4).trim().split("\n")[0];
      expect(firstStatement, name).toMatch(/^if \(!purgeAllowed\(process\.env\)\) return/);
    }
  });
});
