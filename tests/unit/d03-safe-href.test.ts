// D03 (SEC-D02-XSS, defense in depth): stored URLs render as <a href> only when
// they are http(s).
import { describe, expect, it } from "vitest";
import { safeHref } from "../../src/lib/safe-href";

describe("safeHref", () => {
  it.each(["https://example.invalid/x", "http://example.invalid", "HTTPS://EXAMPLE.INVALID/A?b=c#d"])("keeps %s", (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.invalid/x",
    "/relative",
    "",
    "not a url",
  ])("refuses %j", (url) => {
    expect(safeHref(url)).toBeUndefined();
  });

  it.each([null, undefined, 42, {}])("refuses non-strings (%j)", (v) => {
    expect(safeHref(v)).toBeUndefined();
  });
});
