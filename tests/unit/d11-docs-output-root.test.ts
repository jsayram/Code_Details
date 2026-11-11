// D11: the docs generator's output root moves under .test-runtime/ only on the
// isolated test server; everywhere else it is the existing src/app/output.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docsOutputRoot } from "@/lib/docs-output-root";

describe("docsOutputRoot", () => {
  it("is src/app/output normally (production, development, anything without the marker)", () => {
    for (const env of [{}, { CODEDETAILS_ENV_ISOLATED: "0" }, { CODEDETAILS_ENV_ISOLATED: "true" }, { CODEDETAILS_ENV_ISOLATED: "" }, { NODE_ENV: "production" }]) {
      expect(docsOutputRoot(env, "/app")).toBe(path.join("/app", "src", "app", "output"));
    }
  });

  it("is .test-runtime/docs-output only when CODEDETAILS_ENV_ISOLATED is exactly 1", () => {
    expect(docsOutputRoot({ CODEDETAILS_ENV_ISOLATED: "1" }, "/app")).toBe(path.join("/app", ".test-runtime", "docs-output"));
  });

  it("defaults to the process environment and working directory", () => {
    expect(docsOutputRoot()).toBe(path.join(process.cwd(), process.env.CODEDETAILS_ENV_ISOLATED === "1" ? ".test-runtime/docs-output" : "src/app/output"));
  });
});
