// Where the docs generator keeps its files (D11). Always src/app/output,
// except under the isolated test server (CODEDETAILS_ENV_ISOLATED=1, set only
// by tests/support/isolation.ts), where tests get their own directory under
// .test-runtime/ and can never touch a real generated doc.
import path from "node:path";

export function docsOutputRoot(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  return env.CODEDETAILS_ENV_ISOLATED === "1" ? path.join(cwd, ".test-runtime", "docs-output") : path.join(cwd, "src", "app", "output");
}

// D11s: what a doc slug or chapter filename may look like before it is joined
// onto the output root. Anything else is refused outright (never stripped into
// some other slug), so "..", slashes, dots and encoded separators can't leave
// the root or land on a different doc.
const DOC_SLUG = /^[a-z0-9_-]{1,255}$/i;
const CHAPTER_FILENAME = /^[a-z0-9_-][a-z0-9_.-]{0,250}\.md$/i;

export function isSafeDocSlug(slug: unknown): slug is string {
  return typeof slug === "string" && DOC_SLUG.test(slug);
}

export function isSafeChapterFilename(filename: unknown): filename is string {
  return typeof filename === "string" && CHAPTER_FILENAME.test(filename) && !filename.includes("..");
}

/** The doc's directory under `root`; throws for an unsafe slug. */
export function docDir(slug: string, root: string = docsOutputRoot()): string {
  if (!isSafeDocSlug(slug)) throw new Error("unsafe doc slug");
  return path.join(root, slug);
}
