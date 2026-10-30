// D08b, D08g4a: the login switch. Better Auth by default in development with
// local URLs; Clerk otherwise, always outside development, and when
// CODEDETAILS_AUTH_BACKEND=clerk asks for it (until D08g4f/g).
import { describe, expect, it } from "vitest";
import { betterAuthEnabled, chooseAuthBackend } from "@/backend/auth";

const dev = {
  NODE_ENV: "development",
  CODEDETAILS_AUTH_BACKEND: "better-auth",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
};

describe("auth backend switch", () => {
  it("is Clerk with nothing set (no local Convex URLs, not development)", () => {
    expect(chooseAuthBackend({})).toMatchObject({ backend: "clerk" });
    expect(betterAuthEnabled({})).toBe(false);
  });

  it("D08g4a: defaults to Better Auth in development with local URLs and no backend named", () => {
    const { CODEDETAILS_AUTH_BACKEND: _named, ...unnamed } = dev;
    expect(chooseAuthBackend(unnamed)).toEqual({ backend: "better-auth", convexUrl: "http://127.0.0.1:3210", convexSiteUrl: "http://127.0.0.1:3211" });
    expect(chooseAuthBackend({ ...unnamed, CODEDETAILS_AUTH_BACKEND: "" })).toMatchObject({ backend: "better-auth" });
  });

  it("CODEDETAILS_AUTH_BACKEND=clerk still forces Clerk, with the reason", () => {
    expect(chooseAuthBackend({ ...dev, CODEDETAILS_AUTH_BACKEND: "clerk" })).toEqual({ backend: "clerk", reason: "CODEDETAILS_AUTH_BACKEND=clerk" });
  });

  it("falls back to Clerk in development without the local URLs", () => {
    expect(chooseAuthBackend({ NODE_ENV: "development" })).toMatchObject({ backend: "clerk" });
    expect(chooseAuthBackend({ NODE_ENV: "development", CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210" })).toMatchObject({ backend: "clerk" });
  });

  it("uses Better Auth only in development with local URLs", () => {
    expect(chooseAuthBackend(dev)).toEqual({ backend: "better-auth", convexUrl: "http://127.0.0.1:3210", convexSiteUrl: "http://127.0.0.1:3211" });
    expect(chooseAuthBackend({ ...dev, CODEDETAILS_CONVEX_SITE_URL: "http://localhost:3211/" })).toMatchObject({ convexSiteUrl: "http://localhost:3211" });
    expect(betterAuthEnabled(dev)).toBe(true);
  });

  it.each(["production", "test", undefined, "Development", "dev"])("can't be enabled with NODE_ENV=%s", (nodeEnv) => {
    expect(chooseAuthBackend({ ...dev, NODE_ENV: nodeEnv })).toMatchObject({ backend: "clerk" });
  });

  it.each([
    ["a cloud site URL", "CODEDETAILS_CONVEX_SITE_URL", "https://happy-otter-123.convex.site"],
    ["a cloud deployment URL", "CODEDETAILS_CONVEX_URL", "https://happy-otter-123.convex.cloud"],
    ["https on loopback", "CODEDETAILS_CONVEX_SITE_URL", "https://127.0.0.1:3211"],
    ["a LAN address", "CODEDETAILS_CONVEX_SITE_URL", "http://192.168.1.20:3211"],
    ["a lookalike host", "CODEDETAILS_CONVEX_URL", "http://127.0.0.1.example.com:3210"],
    ["no site URL", "CODEDETAILS_CONVEX_SITE_URL", ""],
    ["garbage", "CODEDETAILS_CONVEX_URL", "not a url"],
  ])("refuses %s", (_name, key, value) => {
    expect(chooseAuthBackend({ ...dev, [key]: value })).toMatchObject({ backend: "clerk" });
  });

  it.each(["BETTER-AUTH", "better-auth ", "betterauth", "true", "1"])("ignores the near-miss value %j", (value) => {
    expect(chooseAuthBackend({ ...dev, CODEDETAILS_AUTH_BACKEND: value })).toMatchObject({ backend: "clerk" });
  });
});
