// D08f3b: the error screen's wording comes only from the ?error= code, and
// the post-sign-in redirect stays on the site.
import { describe, expect, it } from "vitest";
import { AUTH_ERROR_TEXT, authErrorKind, safeRedirect } from "@/components/auth/better-auth/authErrors";

describe("authErrorKind", () => {
  it.each([
    ["account_not_linked", "account_not_linked"],
    ["invalid_link", "link"],
    ["INVALID_TOKEN", "link"],
    ["TOKEN_EXPIRED", "link"],
    ["account_already_linked_to_different_user", "connect"],
    ["email_doesn't_match", "connect"],
    ["unable_to_link_account", "connect"],
    ["state_mismatch", "restart"],
    ["please_restart_the_process", "restart"],
    ["access_denied", "restart"],
    ["UNKNOWN", "generic"],
    ["<script>", "generic"],
    ["", "generic"],
    [null, "generic"],
  ] as const)("%s → %s", (code, kind) => {
    expect(authErrorKind(code)).toBe(kind);
  });

  it("f3: account_not_linked uses the neutral wording from D08e decision 4A", () => {
    expect(AUTH_ERROR_TEXT.account_not_linked.body).toBe(
      "This email is already used by a Code Details account. Sign in with your password, then connect GitHub from your settings.",
    );
  });

  it("f6: the link wording says mail apps may open links first and offers a new one", () => {
    expect(AUTH_ERROR_TEXT.link.body).toMatch(/mail apps open links ahead of you/);
    expect(AUTH_ERROR_TEXT.link.body).toMatch(/send a new one/);
  });
});

describe("safeRedirect (no window: server-side base)", () => {
  it.each([
    [null, "/"],
    ["", "/"],
    ["/projects/x?tab=1#a", "/projects/x?tab=1#a"],
    ["//evil.example/x", "/"],
    ["/\\evil.example/x", "/"],
    ["https://evil.example/x", "/"],
    ["javascript:alert(1)", "/"],
    // F02: dot segments and tabs that normalize to another site.
    ["/.//evil.example/x", "/"],
    ["/x/..//evil.example/x", "/"],
    ["/./\\evil.example/x", "/"],
    ["/\t/evil.example/x", "/"],
    ["/projects/new?tab=1", "/projects/new?tab=1"],
    ["/projects/a//b", "/projects/a//b"],
  ])("%s → %s", (value, expected) => {
    expect(safeRedirect(value)).toBe(expected);
  });
});
