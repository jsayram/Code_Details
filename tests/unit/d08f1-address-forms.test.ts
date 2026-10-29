// D08f1: the log check is only as good as its search. revealsAddress must
// find an address inside a JWT payload like Better Auth's verification token,
// and must not fire on someone else's.
import { describe, expect, it } from "vitest";
import { revealsAddress } from "../fixtures/fake-mailpit";

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const jwtFor = (email: string) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ email, iat: 1793250000, exp: 1793253600 }))}.sig`;

describe("revealsAddress", () => {
  it.each(["a@synthetic.invalid", "d08f.long.address.1793250000000.42@synthetic.invalid"])("finds %s inside a JWT in a logged URL", (email) => {
    expect(revealsAddress(`GET /api/auth/verify-email?token=${jwtFor(email)}&callbackURL=%2F 302`, email)).toBe(true);
  });

  it("finds plain, URL-encoded and differently cased forms", () => {
    const email = "a.b@synthetic.invalid";
    for (const line of [`GET /x?e=${email}`, `GET /x?e=${encodeURIComponent(email)}`, `GET /x?e=A.B%40Synthetic.invalid`]) {
      expect(revealsAddress(line, email)).toBe(true);
    }
  });

  it("doesn't fire on another address or an opaque code", () => {
    const line = `GET /api/auth/verify-email?token=${jwtFor("someone.else@synthetic.invalid")} 302\nGET /api/auth/email-link?code=${"A".repeat(43)} 302`;
    expect(revealsAddress(line, "a@synthetic.invalid")).toBe(false);
  });
});
