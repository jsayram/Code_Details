// F02 slice 5: who the analyzer's server tokens may be sent for. fetch is a
// stand-in, so nothing reaches GitHub or any other host, and the tokens are
// made-up strings.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: null as string | null, account: "account-1" as string | null }));
vi.mock("@/lib/auth-server", () => ({
  betterAuthRole: async () => h.role,
  routeDocOwner: async () => (h.account ? { writeKey: h.account } : null),
}));

// H1: the route now fetches through safeFetch. Keep its URL checks, but send
// the request to the fetch stand-in below instead of DNS and a socket.
vi.mock("@/backend/net/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/net/safe-fetch")>();
  return {
    ...actual,
    safeFetch: async (input: string, init: RequestInit = {}) => {
      actual.checkOutboundUrl(input);
      return fetch(input, init);
    },
  };
});

import { POST } from "@/app/api/repo/analyze/route";

const GITHUB = "synthetic-github-token";
const GITLAB = "synthetic-gitlab-token";
const GITEA = "synthetic-gitea-token";
type Call = { url: string; token: string | null };
let calls: Call[];
let visibility: () => Response;

const post = (url: string, token?: string) =>
  POST(new NextRequest("http://localhost/api/repo/analyze", { method: "POST", body: JSON.stringify({ url, ...(token ? { token } : {}) }) }));
const sentAnywhere = (secret: string) => calls.some((c) => c.token === secret || (c.token ?? "").includes(secret));

beforeEach(() => {
  vi.stubEnv("GITHUB_TOKEN", GITHUB);
  vi.stubEnv("GITLAB_TOKEN", GITLAB);
  vi.stubEnv("GITEA_TOKEN", GITEA);
  h.role = "user";
  h.account = "account-1";
  calls = [];
  visibility = () => Response.json({ private: false });
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const url = String(input);
    calls.push({ url, token: headers.Authorization ?? headers["PRIVATE-TOKEN"] ?? null });
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return visibility();
    if (url.includes("/git/trees/") || url.includes("/repository/tree")) return Response.json({ tree: [{ path: "a.ts" }] });
    return new Response("", { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const REPO = "https://github.com/synthetic/repo";
const fetches = () => calls.filter((c) => !/\/repos\/[^/]+\/[^/]+$/.test(c.url));

describe("/api/repo/analyze server tokens", () => {
  it("signed out: 401 and no request anywhere", async () => {
    h.account = null;
    expect((await post(REPO)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("a non-admin on a public GitHub repo keeps the server token, so the rate limit holds", async () => {
    expect((await post(REPO)).status).toBe(200);
    expect(fetches().length).toBeGreaterThan(0);
    expect(fetches().every((c) => c.token === `Bearer ${GITHUB}`)).toBe(true);
  });

  it.each([
    ["private", () => Response.json({ private: true })],
    ["not found", () => new Response("", { status: 404 })],
    ["a failed check", () => new Response("", { status: 500 })],
    ["an answer with no flag", () => Response.json({})],
  ])("a non-admin, %s: the repository is fetched with no token", async (_name, reply) => {
    visibility = reply;
    await post(REPO);
    expect(fetches().length).toBeGreaterThan(0);
    expect(fetches().every((c) => c.token === null)).toBe(true);
  });

  it("a thrown visibility check: no token", async () => {
    visibility = () => {
      throw new Error("synthetic network failure");
    };
    await post(REPO);
    expect(fetches().every((c) => c.token === null)).toBe(true);
  });

  it.each(["https://github.com/../user", "https://github.com/synthetic/..", "https://github.com/a/b%2F..%2F..%2Fuser"])(
    "a non-admin with a path trick, %s: no check and no token",
    async (url) => {
      await post(url);
      expect(sentAnywhere(GITHUB)).toBe(false);
    },
  );

  it.each([
    ["https://gitlab.evil.example/a/b", GITLAB],
    ["https://evil.example/gitea/repo", GITEA],
    ["https://gitlab.com/a/b", GITLAB],
  ])("a non-admin never sends a server token to %s", async (url, secret) => {
    await post(url);
    expect(calls.length).toBeGreaterThan(0);
    expect(sentAnywhere(secret)).toBe(false);
  });

  it("an admin keeps the server tokens, with no visibility check", async () => {
    h.role = "admin";
    await post(REPO);
    expect(calls.every((c) => c.token === `Bearer ${GITHUB}`)).toBe(true);
    expect(calls.some((c) => /\/repos\/synthetic\/repo$/.test(c.url))).toBe(false);
    calls = [];
    await post("https://gitlab.com/a/b");
    expect(calls.every((c) => c.token === GITLAB)).toBe(true);
  });

  it("anyone's own token wins, and no server token goes with it", async () => {
    await post(REPO, "synthetic-own-token");
    expect(calls.every((c) => c.token === "Bearer synthetic-own-token")).toBe(true);
    expect(sentAnywhere(GITHUB)).toBe(false);
  });
});
