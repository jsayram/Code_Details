// D04b: the shared username rules (P07 §5.2): ASCII, 3–30, letter or digit at
// both ends, case-insensitive key, reserved names refused.
import { describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, checkUsername } from "@/backend/profiles/username-rules";

describe("D04b username rules", () => {
  it.each(["abc", "Alice_99", "fixture-alice", "a-b_c", "x".repeat(30), "user-7f3k2q"])("accepts %j", (name) => {
    expect(checkUsername(name)).toMatchObject({ ok: true, username: name, key: name.toLowerCase() });
  });

  it("trims, keeps display casing and lowercases the key", () => {
    expect(checkUsername("  JoseR ")).toEqual({ ok: true, username: "JoseR", key: "joser" });
  });

  it.each([
    ["", /required/],
    ["ab", /3 to 30/],
    ["x".repeat(31), /3 to 30/],
    ["_alice", /start and end/],
    ["alice-", /start and end/],
    ["al ice", /letters, numbers/],
    ["alice!", /letters, numbers/],
    ["ali.ce", /letters, numbers/],
    ["a@b.co", /letters, numbers/],
    ["ádmin", /letters, numbers/],
    ["аlice", /letters, numbers/], // Cyrillic а
    ["admin", /reserved/],
    ["Projects", /reserved/],
    ["sign-in", /reserved/],
  ])("refuses %j", (name, message) => {
    const r = checkUsername(name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });

  it("NFKC folds full-width ASCII before the check", () => {
    expect(checkUsername("ａｌｉｃｅ")).toEqual({ ok: true, username: "alice", key: "alice" });
  });

  it("reserves the app's top-level route segments", () => {
    for (const segment of ["api", "projects", "users", "search", "tags", "categories", "shared-projects", "dashboard", "sign-in", "sign-up", "auth"]) {
      expect(RESERVED_USERNAMES.has(segment), segment).toBe(true);
    }
  });
});
