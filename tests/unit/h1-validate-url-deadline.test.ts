// H1: /api/validate-url has one 5 s budget. When HEAD fails, the GET fallback
// gets only the time that's left. safeFetch is a stand-in; nothing connects.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as { method: string; timeoutMs: number }[] }));
vi.mock("@/backend/net/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/net/safe-fetch")>();
  return {
    ...actual,
    safeFetch: async (_url: string, init: { method: string }, opts: { timeoutMs: number }) => {
      h.calls.push({ method: init.method, timeoutMs: opts.timeoutMs });
      if (init.method === "HEAD") {
        await new Promise((r) => setTimeout(r, 400));
        throw new Error("synthetic HEAD failure");
      }
      return new Response(null, { status: 200 });
    },
  };
});

import { POST } from "@/app/api/validate-url/route";

beforeEach(() => void (h.calls.length = 0));

describe("/api/validate-url deadline", () => {
  it("the GET fallback gets what's left of the 5 s, not a fresh 5 s", async () => {
    const res = await POST(new NextRequest("http://localhost/api/validate-url", { method: "POST", body: JSON.stringify({ url: "https://example.com/" }) }));
    expect(JSON.stringify(await res.json())).toMatch(/"reachable":true/);
    const [head, get] = h.calls;
    expect(head).toMatchObject({ method: "HEAD" });
    expect(head.timeoutMs).toBeLessThanOrEqual(5000);
    expect(get).toMatchObject({ method: "GET" });
    expect(get.timeoutMs).toBeLessThanOrEqual(5000 - 350);
    expect(get.timeoutMs).toBeGreaterThan(0);
  });
});
