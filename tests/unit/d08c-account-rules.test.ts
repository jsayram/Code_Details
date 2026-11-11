// D08c: what a new account copies from its provider (P07 §5.2, §5.4, §5.12).
import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, randomHandle, seedAvatar, seedFullName } from "../../convex/accountRules";

describe("seedFullName", () => {
  it("keeps an ordinary name, tidied", () => {
    expect(seedFullName("  Ada   Lovelace ", "ada@synthetic.invalid")).toBe("Ada Lovelace");
    expect(seedFullName("José Ramírez", null)).toBe("José Ramírez");
  });

  it("drops control and format characters", () => {
    expect(seedFullName("Ada\u0000 Love‮lace​", null)).toBe("Ada Lovelace");
  });

  it.each([
    ["an address", "someone@synthetic.invalid", "other@synthetic.invalid"],
    ["anything with @", "Ada @ Work", "ada@synthetic.invalid"],
    ["the email itself, any case", "ADA@SYNTHETIC.INVALID", "ada@synthetic.invalid"],
    ["empty", "", "ada@synthetic.invalid"],
    ["only whitespace and controls", " \u0007 \t", "ada@synthetic.invalid"],
    ["missing", null, "ada@synthetic.invalid"],
  ])("refuses %s", (_name, name, email) => {
    expect(seedFullName(name, email)).toBeUndefined();
  });

  it(`cuts at ${MAX_NAME_LENGTH} characters without splitting a code point`, () => {
    const name = "😀".repeat(MAX_NAME_LENGTH + 5);
    const seeded = seedFullName(name, null)!;
    expect([...seeded]).toHaveLength(MAX_NAME_LENGTH);
    expect(seeded.endsWith("😀")).toBe(true);
  });
});

describe("seedAvatar", () => {
  it.each([
    "https://avatars.githubusercontent.com/u/1?v=4",
    "https://img.clerk.com/abc",
    "https://www.gravatar.com/avatar/0000",
  ])("accepts %s", (url) => {
    expect(seedAvatar(url)).toEqual({ kind: "external", url });
  });

  it.each([
    ["http", "http://avatars.githubusercontent.com/u/1"],
    ["another host", "https://evil.synthetic.invalid/a.png"],
    ["a lookalike host", "https://avatars.githubusercontent.com.evil.invalid/u/1"],
    ["credentials in the URL", "https://user:pw@avatars.githubusercontent.com/u/1"],
    ["a port", "https://avatars.githubusercontent.com:8443/u/1"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["garbage", "not a url"],
    ["nothing", null],
  ])("refuses %s", (_name, url) => {
    expect(seedAvatar(url)).toBeUndefined();
  });
});

describe("randomHandle", () => {
  it("is user- plus 6 base-36 characters and fits the username rule", () => {
    for (let i = 0; i < 200; i++) {
      const h = randomHandle();
      expect(h).toMatch(/^user-[0-9a-z]{6}$/);
      expect(h).toMatch(/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/);
    }
  });

  it("doesn't repeat in 500 draws (collision chance about 0.006%)", () => {
    const seen = new Set(Array.from({ length: 500 }, randomHandle));
    expect(seen.size).toBe(500);
  });
});
