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

  it("no automatic purge: no scheduled job calls the purge or its batches (P07 §5.11)", () => {
    const crons = fs.readFileSync(path.resolve(__dirname, "../../convex/crons.ts"), "utf8");
    expect(crons).not.toMatch(/projectLifecycle|purge/i);
  });
});
