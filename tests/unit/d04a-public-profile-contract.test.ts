// D04a: the public profile contract refuses anything private and maps legacy
// email-shaped names to their local part.
import { describe, expect, it } from "vitest";
import {
  assertPublicProfile,
  assertPublicProfileRow,
  publicUsername,
  rowFromPublicProfile,
  toPublicProfileRow,
  usernameKey,
} from "@/backend/profiles/public-profile";

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  user_id: "user_fixture_a",
  username: "fixture-alice",
  full_name: "Alice Fixture",
  profile_image_url: "https://avatars.synthetic.invalid/a.png",
  tier: "pro",
  email_address: "a@synthetic.invalid",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-02T00:00:00Z"),
};

describe("D04a public profile contract", () => {
  it("keeps only the public fields of a full row", () => {
    expect(toPublicProfileRow(row)).toEqual({
      username: "fixture-alice",
      full_name: "Alice Fixture",
      profile_image_url: "https://avatars.synthetic.invalid/a.png",
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  });

  it("publishes the local part of an email-shaped username or name", () => {
    expect(toPublicProfileRow({ ...row, username: "legacy@synthetic.invalid", full_name: "legacy@synthetic.invalid" })).toMatchObject({
      username: "legacy",
      full_name: "legacy",
    });
    expect(publicUsername("plain")).toBe("plain");
  });

  it("refuses extra keys, missing keys, emails and provider subjects", () => {
    const ok = toPublicProfileRow(row);
    expect(() => assertPublicProfileRow({ ...ok, email_address: null })).toThrow(/email_address is not public/);
    expect(() => assertPublicProfileRow({ ...ok, tier: "free" })).toThrow(/tier is not public/);
    const missing: Record<string, unknown> = { ...ok };
    delete missing.updated_at;
    expect(() => assertPublicProfileRow(missing)).toThrow(/updated_at is missing/);
    expect(() => assertPublicProfileRow({ ...ok, username: "x@y.invalid" })).toThrow(/email address/);
    expect(() => assertPublicProfileRow({ ...ok, full_name: "user_2abcDEF" })).toThrow(/provider subject/);
    expect(() => assertPublicProfile({ username: "a", fullName: null, avatarUrl: null, createdAt: "", updatedAt: "", userId: "u" })).toThrow(/userId is not public/);
  });

  it("maps the Convex answer to the legacy row", () => {
    expect(rowFromPublicProfile({ username: "a", fullName: null, avatarUrl: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })).toEqual({
      username: "a",
      full_name: null,
      profile_image_url: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("canonical key: trim, NFKC, lowercase", () => {
    expect(usernameKey("  Ｆixture-ALICE ")).toBe("fixture-alice");
  });
});
