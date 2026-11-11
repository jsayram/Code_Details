// SEC-D09-PUSHHEAD: every refusal of the dev/import push guard, without
// touching git or a backend (git and file checks are injected).
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// push-guard.mjs is an ES module (push.mjs runs it under plain node); this file compiles as CommonJS.
type GuardModule = {
  OWNER_FILES: string[];
  pushGuardProblems: (o: { target: string; expectHead: string | undefined; cwd: string; git: (args: string[]) => string; exists: (p: string) => boolean }) => string[];
  takeExpectHead: (argv: string[]) => string | undefined;
};
let OWNER_FILES: GuardModule["OWNER_FILES"];
let pushGuardProblems: GuardModule["pushGuardProblems"];
let takeExpectHead: GuardModule["takeExpectHead"];
beforeAll(async () => {
  ({ OWNER_FILES, pushGuardProblems, takeExpectHead } = (await import("../convex/push-guard.mjs")) as GuardModule);
});

const HEAD = "1f9e849aa7d3c0ffee00000000000000000000aa";
type Repo = { head?: string; status?: string; gitDir?: string; commonDir?: string; locks?: string[] };
const guard = (target: string, expectHead: string | undefined, repo: Repo = {}) =>
  pushGuardProblems({
    target,
    expectHead,
    cwd: "/repo/wt",
    git: (args: string[]) => {
      const cmd = args.join(" ");
      if (cmd === "rev-parse HEAD") return `${repo.head ?? HEAD}\n`;
      if (cmd === "rev-parse --git-dir") return `${repo.gitDir ?? "/repo/.git/worktrees/wt"}\n`;
      if (cmd === "rev-parse --git-common-dir") return `${repo.commonDir ?? "/repo/.git"}\n`;
      if (cmd.startsWith("status --porcelain")) return repo.status ?? "";
      throw new Error(`unexpected git ${cmd}`);
    },
    exists: (p: string) => (repo.locks ?? []).includes(p),
  });

describe("push guard", () => {
  it("leaves the test and manual targets alone", () => {
    expect(guard("test", undefined, { head: "deadbeef", locks: ["/repo/.git/index.lock"], status: " M convex/x.ts\n" })).toEqual([]);
    expect(guard("manual", undefined)).toEqual([]);
  });

  it.each(["dev", "import"])("%s: refuses without --expect-head", (target) => {
    expect(guard(target, undefined)).toEqual([`--target ${target} needs --expect-head <sha> (the commit you mean to push)`]);
  });

  it("refuses a malformed sha", () => {
    expect(guard("dev", "")[0]).toMatch(/7 to 40 hex/);
    expect(guard("dev", "1f9e")[0]).toMatch(/7 to 40 hex/);
    expect(guard("dev", "zzzzzzz")[0]).toMatch(/7 to 40 hex/);
  });

  it("refuses when HEAD is another commit, accepts a matching short or full sha", () => {
    expect(guard("dev", "24b6307", { head: HEAD })).toEqual([`HEAD is ${HEAD.slice(0, 12)}, not 24b6307`]);
    expect(guard("dev", "1f9e849")).toEqual([]);
    expect(guard("dev", "1F9E849AA7")).toEqual([]);
    expect(guard("dev", HEAD)).toEqual([]);
  });

  it("refuses while an index.lock exists, in the worktree's git dir or the common dir", () => {
    expect(guard("dev", "1f9e849", { locks: ["/repo/.git/index.lock"] })).toEqual(["/repo/.git/index.lock exists: a git operation is unfinished"]);
    expect(guard("import", "1f9e849", { locks: ["/repo/.git/worktrees/wt/index.lock"] })).toEqual(["/repo/.git/worktrees/wt/index.lock exists: a git operation is unfinished"]);
    // Relative dirs (a plain checkout answers ".git") resolve against the pushed folder.
    expect(guard("dev", "1f9e849", { gitDir: ".git", commonDir: ".git", locks: ["/repo/wt/.git/index.lock"] })).toHaveLength(1);
  });

  it("refuses staged, unstaged, untracked and renamed changes, but not Jose's own three files", () => {
    const owner = OWNER_FILES.map((f, i) => (i === 2 ? `?? ${f}` : ` M ${f}`)).join("\n");
    expect(guard("dev", "1f9e849", { status: `${owner}\n` })).toEqual([]);
    expect(guard("dev", "1f9e849", { status: `${owner}\nM  convex/schema.ts\n` })).toEqual(["the working tree differs from HEAD: convex/schema.ts"]);
    expect(guard("dev", "1f9e849", { status: " M src/x.ts\n?? convex/new.ts\nR  old.ts -> convex/renamed.ts\n" })).toEqual([
      "the working tree differs from HEAD: src/x.ts, convex/new.ts, convex/renamed.ts",
    ]);
  });

  it("reports every problem at once", () => {
    expect(guard("dev", "24b6307", { locks: ["/repo/.git/index.lock"], status: " M convex/a.ts\n" })).toHaveLength(3);
  });

  it("takes --expect-head out of the arguments passed on to the Convex CLI", () => {
    const argv = ["--target", "dev", "--expect-head", "1f9e849", "--yes"];
    expect(takeExpectHead(argv)).toBe("1f9e849");
    expect(argv).toEqual(["--target", "dev", "--yes"]);
    const bare = ["--expect-head"];
    expect(takeExpectHead(bare)).toBe("");
    expect(takeExpectHead(["--target", "dev"])).toBeUndefined();
  });

  it("push.mjs runs the guard before it reads any backend settings or calls the CLI, and exits on a refusal", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../convex/push.mjs"), "utf8");
    const guardAt = src.indexOf("pushGuardProblems({");
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(src.indexOf("const runtime = {"));
    expect(guardAt).toBeLessThan(src.indexOf("fs.readFileSync(envFile"));
    expect(guardAt).toBeLessThan(src.indexOf("const convex = (args)"));
    expect(src.slice(guardAt, guardAt + 400)).toMatch(/process\.exit\(1\)/);
  });
});
