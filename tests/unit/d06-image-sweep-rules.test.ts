// D06-c: the orphan image sweep deletes files, so it is opt-in per deployment
// (the D04d pattern): exactly "1", set only by tests/convex/push.mjs for the
// test target, and checked before the sweep reads anything.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORPHAN_MIN_AGE_MS, ORPHAN_SWEEP_BATCH, sweepAllowed } from "@/backend/projects/image-sweep-rules";

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("D06-c orphan sweep rules", () => {
  it("an upload is an orphan after 24 hours; steps are bounded", () => {
    expect(ORPHAN_MIN_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(ORPHAN_SWEEP_BATCH).toBeGreaterThan(0);
    expect(ORPHAN_SWEEP_BATCH).toBeLessThanOrEqual(1000);
  });

  it("runs only where the deployment set the flag to exactly 1", () => {
    expect(sweepAllowed({ CODEDETAILS_IMAGE_SWEEP_ALLOWED: "1" })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", " 1", "1 "]) {
      expect(sweepAllowed({ CODEDETAILS_IMAGE_SWEEP_ALLOWED: value }), String(value)).toBe(false);
    }
    expect(sweepAllowed({ CODEDETAILS_ACCOUNT_PURGE_ALLOWED: "1" })).toBe(false);
  });

  it("the sweep's first statement is the flag check", () => {
    const src = read("convex/projectImages.ts");
    const body = src.slice(src.indexOf("export const sweepOrphans = internalMutation("));
    const handler = body.slice(body.indexOf("handler:"));
    const firstStatement = handler.slice(handler.indexOf("=> {") + 4).trim().split("\n")[0];
    expect(firstStatement).toMatch(/^if \(!sweepAllowed\(process\.env\)\) return/);
  });

  it("the cron calls the gated sweep, and only the test target sets the flag", () => {
    const crons = read("convex/crons.ts").split("\n").filter((l) => !l.trim().startsWith("//"));
    expect(crons.filter((l) => /sweepOrphans/.test(l))).toEqual([
      'crons.hourly("sweep orphaned image uploads", { minuteUTC: 53 }, internal.projectImages.sweepOrphans, {});',
    ]);
    const sets = read("tests/convex/push.mjs").split("\n").filter((l) => l.includes("CODEDETAILS_IMAGE_SWEEP_ALLOWED") && !l.trim().startsWith("//"));
    expect(sets).toEqual([
      'if (res.status === 0 && !dryRun && target === "test") res = convex(["env", "set", "CODEDETAILS_IMAGE_SWEEP_ALLOWED", "1"]);',
    ]);
    // Nothing else in the repo turns it on.
    const hits = execSync("git grep -l --untracked -e CODEDETAILS_IMAGE_SWEEP_ALLOWED -- . ':!tests/unit/d06-image-sweep-rules.test.ts'", { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(hits).toEqual([
      "convex/crons.ts",
      "convex/projectImages.ts",
      "src/backend/projects/image-sweep-rules.ts",
      "tests/convex/push.mjs",
      "tests/integration/d06-convex-image-sweep.test.ts", // comment only
    ]);
  });
});
