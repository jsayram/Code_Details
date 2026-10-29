// Where the docs generator keeps its files (D11). Always src/app/output,
// except under the isolated test server (CODEDETAILS_ENV_ISOLATED=1, set only
// by tests/support/isolation.ts), where tests get their own directory under
// .test-runtime/ and can never touch a real generated doc.
import path from "node:path";

export function docsOutputRoot(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  return env.CODEDETAILS_ENV_ISOLATED === "1" ? path.join(cwd, ".test-runtime", "docs-output") : path.join(cwd, "src", "app", "output");
}
