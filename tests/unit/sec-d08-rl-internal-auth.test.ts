// SEC-D08-RL, the pure and Next.js halves: the internal secret check, the
// server's token call (cookie and secret only: no browser header such as
// X-Forwarded-For is passed on). The route half is sec-d08-rl-auth-route.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_AUTH_HEADER, MIN_INTERNAL_SECRET_LENGTH, isInternalAuthCall, staticJwks } from "../../convex/authRules";
import { betterAuthSignedIn, viewerForCookies, viewerQuery } from "@/lib/auth-server";

const SECRET = "SYNTHETIC-" + "s".repeat(40);
const SWITCH = {
  NODE_ENV: "development",
  CODEDETAILS_AUTH_BACKEND: "better-auth",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
  CODEDETAILS_INTERNAL_AUTH_SECRET: SECRET,
};

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => incoming.headers }));
vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn(async () => ({ username: "user-abcdef", role: "user", tier: "free" })) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

describe("isInternalAuthCall", () => {
  it("accepts only the exact secret", () => {
    expect(isInternalAuthCall(SECRET, SECRET)).toBe(true);
    expect(isInternalAuthCall(SECRET.slice(0, -1) + "x", SECRET)).toBe(false);
    expect(isInternalAuthCall(SECRET + "x", SECRET)).toBe(false);
    expect(isInternalAuthCall("", SECRET)).toBe(false);
    expect(isInternalAuthCall(null, SECRET)).toBe(false);
  });

  it("refuses everything when the secret is unset or too short", () => {
    expect(isInternalAuthCall("anything", undefined)).toBe(false);
    const short = "x".repeat(MIN_INTERNAL_SECRET_LENGTH - 1);
    expect(isInternalAuthCall(short, short)).toBe(false);
  });
});

describe("staticJwks", () => {
  it("passes a key set through and treats the placeholder or nothing as no static JWKS", () => {
    expect(staticJwks('[{"id":"k"}]')).toBe('[{"id":"k"}]');
    expect(staticJwks("unset")).toBeUndefined();
    expect(staticJwks("")).toBeUndefined();
    expect(staticJwks(undefined)).toBeUndefined();
  });
});

describe("the server's token call", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    for (const [k, v] of Object.entries(SWITCH)) vi.stubEnv(k, v);
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ token: "convex.jwt" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("viewerQuery sends the request's cookie and the secret, nothing else from the browser", async () => {
    incoming.headers = new Headers({ cookie: "better-auth.session_token=abc", "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9", "user-agent": "browser" });
    await viewerQuery({} as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3211/api/auth/convex/token");
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(["accept-encoding", "cookie", INTERNAL_AUTH_HEADER].sort());
    expect((init.headers as Record<string, string>)[INTERNAL_AUTH_HEADER]).toBe(SECRET);
  });

  it("viewerForCookies (the proxy) does the same", async () => {
    expect(await viewerForCookies("better-auth.session_token=abc")).toEqual({ role: "user" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)[INTERNAL_AUTH_HEADER]).toBe(SECRET);
  });

  it("without a cookie there is no call and nobody is signed in", async () => {
    incoming.headers = new Headers();
    expect(await betterAuthSignedIn()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without the secret configured, the call goes out without the header", async () => {
    vi.stubEnv("CODEDETAILS_INTERNAL_AUTH_SECRET", "");
    await viewerForCookies("better-auth.session_token=abc");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty(INTERNAL_AUTH_HEADER);
  });
});
