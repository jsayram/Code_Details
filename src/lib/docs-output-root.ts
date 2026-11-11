// Where the docs generator keeps its files (D11). Always src/app/output,
// except under the isolated test server (CODEDETAILS_ENV_ISOLATED=1, set only
// by tests/support/isolation.ts), where tests get their own directory under
// .test-runtime/ and can never touch a real generated doc.
//
// X2: the slug and chapter-name checks live with the engine's DocStore
// (`repo-docs/store`, which has no disk access); they are
// re-exported here for the app. This module needs only node:path.
import path from "node:path";
import { isSafeDocSlug } from "repo-docs/store";

export { isSafeChapterFilename, isSafeDocSlug } from "repo-docs/store";

export function docsOutputRoot(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  return env.CODEDETAILS_ENV_ISOLATED === "1" ? path.join(cwd, ".test-runtime", "docs-output") : path.join(cwd, "src", "app", "output");
}

/** The doc's directory under `root`; throws for an unsafe slug. */
export function docDir(slug: string, root: string = docsOutputRoot()): string {
  if (!isSafeDocSlug(slug)) throw new Error("unsafe doc slug");
  return path.join(root, slug);
}
