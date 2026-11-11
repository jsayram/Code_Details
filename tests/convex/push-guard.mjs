// SEC-D09-PUSHHEAD: the pre-push check for the backends that hold real data.
// `--target dev` (Jose's dev app, 3240) and `--target import` (3220) refuse to
// push unless the caller names the commit it means to push with
// `--expect-head <sha>`, HEAD of the folder being pushed is that commit, no
// `.git/index.lock` exists (a half-finished git operation, as on 2026-10-31),
// and nothing but Jose's own three uncommitted files differs from HEAD. The
// test target (each slot's throwaway backend) is unchanged. Pure apart from
// the injected git and file checks, so tests/unit/push-guard.test.ts can run
// every refusal without touching a backend.
import path from "node:path";

export const GUARDED_TARGETS = ["dev", "import"];
/** Jose's uncommitted files in the main checkout; never a reason to refuse. */
export const OWNER_FILES = ["AGENTS.md", "docs/SEARCH_ARCHITECTURE.md", "docs/CODE_MAP.md"];

/** Removes `--expect-head <sha>` from argv (in place) and returns the sha, or undefined. */
export function takeExpectHead(argv) {
  const i = argv.indexOf("--expect-head");
  if (i === -1) return undefined;
  const sha = argv[i + 1];
  argv.splice(i, sha === undefined ? 1 : 2);
  return sha ?? "";
}

/** Paths in `git status --porcelain` output, rename targets included. */
function changedPaths(porcelain) {
  return porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""));
}

/**
 * Why a push must not run; an empty list means it may.
 * git(args) returns stdout (it runs in the folder being pushed); exists(p) checks a file.
 */
export function pushGuardProblems({ target, expectHead, cwd, git, exists }) {
  if (!GUARDED_TARGETS.includes(target)) return [];
  if (expectHead === undefined) return [`--target ${target} needs --expect-head <sha> (the commit you mean to push)`];
  const problems = [];
  if (!/^[0-9a-f]{7,40}$/i.test(expectHead)) problems.push(`--expect-head must be a commit sha of 7 to 40 hex characters, got ${JSON.stringify(expectHead)}`);
  const head = git(["rev-parse", "HEAD"]).trim().toLowerCase();
  if (problems.length === 0 && !head.startsWith(expectHead.toLowerCase())) problems.push(`HEAD is ${head.slice(0, 12)}, not ${expectHead}`);
  const dirs = new Set([git(["rev-parse", "--git-dir"]).trim(), git(["rev-parse", "--git-common-dir"]).trim()].map((d) => path.resolve(cwd, d)));
  for (const dir of dirs) if (exists(path.join(dir, "index.lock"))) problems.push(`${path.join(dir, "index.lock")} exists: a git operation is unfinished`);
  const dirty = changedPaths(git(["status", "--porcelain", "--untracked-files=all"])).filter((p) => !OWNER_FILES.includes(p));
  if (dirty.length) problems.push(`the working tree differs from HEAD: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", …" : ""}`);
  return problems;
}
