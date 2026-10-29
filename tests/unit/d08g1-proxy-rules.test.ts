// D08g1: the proxy's decisions while the Better Auth switch is on.
import { describe, expect, it } from "vitest";
import { betterAuthDecision, hasSessionCookie, isApiPath, signInLocation } from "@/backend/auth/proxy-rules";

const user = { role: "user" as const };
const admin = { role: "admin" as const };
const decide = (pathname: string, o: { isPublic?: boolean; isAdmin?: boolean; viewer?: { role: "user" | "admin" } | null; search?: string } = {}) =>
  betterAuthDecision({ pathname, search: o.search ?? "", isPublic: !!o.isPublic, isAdmin: !!o.isAdmin, viewer: o.viewer ?? null });

describe("betterAuthDecision", () => {
  it("public routes pass, signed in or not", () => {
    expect(decide("/", { isPublic: true })).toEqual({ kind: "next" });
    expect(decide("/api/auth/get-session", { isPublic: true })).toEqual({ kind: "next" });
  });

  it("signed out: pages go to /sign-in and come back with their query", () => {
    expect(decide("/dashboard", { search: "?tab=a&b=1" })).toEqual({ kind: "redirect", location: "/sign-in?redirect_url=%2Fdashboard%3Ftab%3Da%26b%3D1" });
  });

  it("signed out: APIs answer 401", () => {
    expect(decide("/api/projects/x")).toEqual({ kind: "unauthorized" });
    expect(decide("/trpc/x")).toEqual({ kind: "unauthorized" });
  });

  it("signed in: protected routes pass", () => {
    expect(decide("/dashboard", { viewer: user })).toEqual({ kind: "next" });
    expect(decide("/api/projects/x", { viewer: user })).toEqual({ kind: "next" });
  });

  it("admin routes: a non-admin goes to /dashboard, an admin passes, signed out goes to sign-in", () => {
    expect(decide("/dashboard/admin", { isAdmin: true, viewer: user })).toEqual({ kind: "redirect", location: "/dashboard" });
    expect(decide("/dashboard/admin", { isAdmin: true, viewer: admin })).toEqual({ kind: "next" });
    expect(decide("/dashboard/admin", { isAdmin: true })).toEqual({ kind: "redirect", location: "/sign-in?redirect_url=%2Fdashboard%2Fadmin" });
    expect(decide("/api/projects/test", { isAdmin: true })).toEqual({ kind: "unauthorized" });
  });
});

describe("helpers", () => {
  it.each([
    ["/api", true],
    ["/api/x", true],
    ["/trpc/x", true],
    ["/apix", false],
    ["/dashboard", false],
  ])("isApiPath(%s) = %s", (p, expected) => {
    expect(isApiPath(p)).toBe(expected);
  });

  it.each([
    [null, false],
    ["", false],
    ["other=1", false],
    ["xbetter-auth.session_token=a", false],
    ["better-auth.session_token=a", true],
    ["a=1; better-auth.session_token=a", true],
    ["a=1; __Secure-better-auth.session_token=a", true],
  ])("hasSessionCookie(%j) = %s", (cookie, expected) => {
    expect(hasSessionCookie(cookie)).toBe(expected);
  });

  it("signInLocation encodes the path", () => {
    expect(signInLocation("/a b", "?x=/y")).toBe("/sign-in?redirect_url=%2Fa%20b%3Fx%3D%2Fy");
  });
});
