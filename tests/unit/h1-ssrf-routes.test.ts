// H1: the analyzer and the link checker refuse internal hosts before any
// socket opens. The real guard runs here; the isolation guard in
// vitest-setup.ts would turn any attempted connection into a failure.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "user" as string | null }));
vi.mock("@/lib/auth-server", () => ({
  betterAuthRole: async () => h.role,
  routeDocOwner: async () => (h.role ? { writeKey: "account-1" } : null),
}));

import { POST as analyze } from "@/app/api/repo/analyze/route";
import { POST as validateUrl } from "@/app/api/validate-url/route";

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.role = "user";
  vi.stubGlobal("fetch", async () => {
    throw new Error("global fetch must not be used for user URLs");
  });
});

describe("/api/repo/analyze internal hosts", () => {
  it.each([
    "https://gitlab.internal/group/repo",
    "https://gitlab.localhost/group/repo",
    "https://gitlab@127.0.0.1/group/repo",
    "https://gitlab.example.com:8443/group/repo",
    "https://gitea.corp/owner/repo",
  ])("%s: 400, nothing fetched", async (url) => {
    const res = await analyze(post("/api/repo/analyze", { url }));
    expect(res.status).toBe(400);
  });

  it("admins get the same refusal", async () => {
    h.role = "admin";
    expect((await analyze(post("/api/repo/analyze", { url: "https://gitlab.internal/g/r" }))).status).toBe(400);
  });
});

describe("/api/validate-url internal hosts", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3240/version",
    "http://localhost:3000/",
    "http://[::1]/",
    "http://10.0.0.1/",
  ])("%s: reported unreachable without a request", async (url) => {
    const res = await validateUrl(post("/api/validate-url", { url }));
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/"reachable":false/);
    expect(JSON.stringify(json)).toMatch(/not reachable from this server|default http and https ports|not allowed/);
  });
});

describe("serverGithubCrawler path parts", () => {
  it.each(["owner/repo#../../user", "owner/repo@a/../../b", "owner/repo#a//b", "owner/repo#a?b"])(
    "%s: refused before any request",
    async (repoUrl) => {
      const { serverGithubCrawler } = await import("@/repoScrapper/server-crawler");
      await expect(serverGithubCrawler({ repoUrl } as never)).rejects.toMatchObject({ detail: expect.stringMatching(/Invalid GitHub URL/) });
    },
  );
});
