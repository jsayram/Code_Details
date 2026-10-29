// D08f1 (f4): the email-verification opt-out can't reach a real deployment.
import { describe, expect, it } from "vitest";
import { emailVerificationRequired, isLoopbackSite } from "../../convex/authRules";

const OFF = { CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION: "0" };

describe("emailVerificationRequired", () => {
  it.each(["http://127.0.0.1:3211", "http://localhost:3231", "http://[::1]:3211"])("loopback %s + \"0\" → off", (site) => {
    expect(emailVerificationRequired({ ...OFF, CONVEX_SITE_URL: site })).toBe(false);
  });

  it.each([
    ["a hosted site URL", "https://happy-otter-123.convex.site"],
    ["https on loopback", "https://127.0.0.1:3211"],
    ["a LAN address", "http://192.168.1.20:3211"],
    ["a lookalike host", "http://127.0.0.1.example.com:3211"],
    ["no site URL", undefined],
    ["garbage", "not a url"],
  ])("%s + \"0\" → still required", (_name, site) => {
    expect(emailVerificationRequired({ ...OFF, CONVEX_SITE_URL: site })).toBe(true);
  });

  it.each(["http://127.0.0.1:3211", "https://happy-otter-123.convex.site", undefined])("unset → required (site %s)", (site) => {
    expect(emailVerificationRequired({ CONVEX_SITE_URL: site })).toBe(true);
  });

  it.each(["1", "false", "no", "", " 0", "00"])("any value but exactly \"0\" (%j) → required, even on loopback", (value) => {
    expect(emailVerificationRequired({ CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION: value, CONVEX_SITE_URL: "http://127.0.0.1:3211" })).toBe(true);
  });
});

describe("isLoopbackSite", () => {
  it("accepts only plain http on this machine", () => {
    expect(isLoopbackSite("http://127.0.0.1:3211")).toBe(true);
    expect(isLoopbackSite("https://localhost:3211")).toBe(false);
    expect(isLoopbackSite("http://10.0.0.1")).toBe(false);
  });
});
