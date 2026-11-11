// F02 slice 5: /api/repo/crawl falls back to the server's GitHub token and
// returns file contents, so only an admin may call it. GitHub is never reached
// here: fetch is a stand-in and the token is a made-up string.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: null as string | null, account: null as string | null, crawls: [] as { repoUrl: string; token?: string }[] }));
vi.mock("@/lib/auth-server", () => ({
  betterAuthRole: async () => h.role,
  routeDocOwner: async () => (h.account ? { writeKey: h.account } : null),
}));
vi.mock("repo-docs/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("repo-docs/server")>()),
  serverGithubCrawler: async (options: { repoUrl: string; token?: string }) => {
    h.crawls.push(options);
    return { files: { "a.ts": "x" }, stats: { skipped_count: 0, excluded_count: 0 } };
  },
}));

import { POST } from "@/app/api/repo/crawl/route";

const SERVER_TOKEN = "synthetic-server-token";
let n = 0;
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/repo/crawl", { method: "POST", body: JSON.stringify(body) }));
const body = { repoUrl: "https://github.com/synthetic/private" };

beforeEach(() => {
  vi.stubEnv("GITHUB_TOKEN", SERVER_TOKEN);
  h.crawls = [];
  h.role = null;
  h.account = `account-${++n}`; // the route's own rate limit is per account
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/repo/crawl", () => {
  it("signed out: 401, nothing crawled", async () => {
    h.account = null;
    expect((await post(body)).status).toBe(401);
    expect(h.crawls).toEqual([]);
  });

  it("a signed-in non-admin: 403, nothing crawled, even with their own token", async () => {
    h.role = "user";
    expect((await post(body)).status).toBe(403);
    expect((await post({ ...body, githubToken: "synthetic-own-token" })).status).toBe(403);
    expect(h.crawls).toEqual([]);
  });

  it("an admin keeps the server token, and their own token wins", async () => {
    h.role = "admin";
    expect((await post(body)).status).toBe(200);
    expect(h.crawls[0].token).toBe(SERVER_TOKEN);
    h.account = `account-${++n}`;
    expect((await post({ ...body, githubToken: "synthetic-own-token" })).status).toBe(200);
    expect(h.crawls[1].token).toBe("synthetic-own-token");
  });
});
