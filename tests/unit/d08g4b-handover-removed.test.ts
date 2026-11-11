// D08g4b: the D08d Clerk-session handover is gone, on both sides. Nothing in
// the app or the Convex functions still serves, calls or links to it, and no
// secret for it is handed to the test backend or the browser-test server.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const files = execSync("git ls-files --cached --others --exclude-standard -- src convex", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !f.startsWith("convex/_generated/"));
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

describe("D08g4b handover removed", () => {
  it("its route, Convex action and screen files are gone", () => {
    for (const f of ["src/app/api/account/handover/route.ts", "convex/handover.ts"]) expect(fs.existsSync(path.join(root, f)), f).toBe(false);
  });

  it("no app or Convex source serves, calls or links to it", () => {
    const pattern = /\/account\/handover|\/sign-in\/handover|HandoverScreen|HANDOVER_PATH|CODEDETAILS_HANDOVER_SECRET|x-codedetails-handover-secret|internal\.handover/;
    expect(files.filter((f) => pattern.test(read(f)))).toEqual([]);
  });

  it("no handover secret goes to the test backend or the browser-test server", () => {
    for (const f of ["tests/convex/push.mjs", "playwright.config.ts"]) expect(read(f), f).not.toMatch(/HANDOVER/i);
  });

  it("the generated API no longer lists a handover module", () => {
    expect(read("convex/_generated/api.d.ts")).not.toMatch(/handover/);
  });
});
