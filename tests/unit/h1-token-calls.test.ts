// H1 (UI02 decision 5): every server read as the signed-in user gets its
// Convex token from the server's own call (cookie + internal secret, outside
// the per-address limiter), including viewerQueryWithArgs, which used the
// component's getToken() before. No network: fetch and Convex are doubles.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_AUTH_HEADER } from "../../convex/authRules";

const SECRET = "SYNTHETIC-" + "s".repeat(40);
const incoming = vi.hoisted(() => ({ headers: new Headers() }));
const queries = vi.hoisted(() => [] as { args: unknown; token: unknown }[]);
vi.mock("next/headers", () => ({ headers: async () => incoming.headers }));
vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(async (_ref: unknown, args: unknown, opts: { token?: unknown }) => {
    queries.push({ args, token: opts.token });
    return { ok: true };
  }),
}));
vi.mock("@convex-dev/better-auth/nextjs", () => ({
  convexBetterAuthNextJs: () => ({
    getToken: async () => {
      throw new Error("the component's getToken must not be used");
    },
  }),
}));

import { viewerQueryWithArgs } from "@/lib/auth-server";

const fetchMock = vi.fn();
beforeEach(() => {
  for (const [k, v] of Object.entries({
    NODE_ENV: "development",
    CODEDETAILS_AUTH_BACKEND: "better-auth",
    CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
    CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
    CODEDETAILS_INTERNAL_AUTH_SECRET: SECRET,
  }))
    vi.stubEnv(k, v);
  queries.length = 0;
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ token: "convex.jwt" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("viewerQueryWithArgs", () => {
  it("uses the server's token call with the internal secret and no browser headers", async () => {
    incoming.headers = new Headers({ cookie: "better-auth.session_token=abc", "x-forwarded-for": "203.0.113.9" });
    expect(await viewerQueryWithArgs({} as never, { slug: "s" })).toEqual({ result: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3211/api/auth/convex/token");
    const sent = init.headers as Record<string, string>;
    expect(sent[INTERNAL_AUTH_HEADER]).toBe(SECRET);
    expect(sent["x-forwarded-for"]).toBeUndefined();
    expect(queries).toEqual([{ args: { slug: "s" }, token: "convex.jwt" }]);
  });

  it("signed out: no token call, the query runs anonymously", async () => {
    incoming.headers = new Headers();
    await viewerQueryWithArgs({} as never, { slug: "s" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queries).toEqual([{ args: { slug: "s" }, token: undefined }]);
  });

  it("a refused token reads anonymously rather than with a stale token", async () => {
    incoming.headers = new Headers({ cookie: "better-auth.session_token=expired" });
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await viewerQueryWithArgs({} as never, {});
    expect(queries[0].token).toBeUndefined();
  });
});

describe("auth-server source", () => {
  it("has no getToken() call left and memoizes the request token", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/lib/auth-server.ts"), "utf8");
    expect(src).not.toMatch(/\.getToken\(/);
    expect(src).toMatch(/const requestToken = cache\(/);
    // the definition, requestToken, and the proxy's viewerForCookies
    expect(src.match(/\bserverToken\(/g)).toHaveLength(3);
  });
});
