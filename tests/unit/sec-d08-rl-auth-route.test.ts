// SEC-D08-RL: the /api/auth route removes the server's internal header from
// browser requests before forwarding them to the auth site. SEC-D08-XFF: it
// also drops browser-supplied client-IP headers unless a trusted-proxy list is set.
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_AUTH_HEADER, TEST_CLIENT_IP_HEADER } from "../../convex/authRules";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/auth/[...all]/route";

const forwarded = vi.hoisted(() => [] as Request[]);
vi.mock("@/lib/auth-server", () => ({
  betterAuthServer: async () => ({
    handler: {
      GET: async (r: Request) => (forwarded.push(r), new Response("ok")),
      POST: async (r: Request) => (forwarded.push(r), new Response("ok")),
    },
  }),
}));

describe("/api/auth route", () => {
  it("removes the internal header a browser request carries, and keeps the rest", async () => {
    const secret = "SYNTHETIC-" + "s".repeat(40);
    await GET(new NextRequest("http://localhost:3000/api/auth/convex/token", { headers: { [INTERNAL_AUTH_HEADER]: secret, cookie: "a=b" } }));
    await POST(new NextRequest("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { [INTERNAL_AUTH_HEADER]: secret, "content-type": "application/json" }, body: "{}" }));
    expect(forwarded.map((r) => r.headers.has(INTERNAL_AUTH_HEADER))).toEqual([false, false]);
    expect(forwarded[0].headers.get("cookie")).toBe("a=b");
    expect(await forwarded[1].text()).toBe("{}");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("drops X-Forwarded-For, X-Real-IP and Forwarded from the browser, keeping the test header", async () => {
    forwarded.length = 0;
    vi.stubEnv("CODEDETAILS_AUTH_TRUSTED_PROXIES", "");
    await GET(new NextRequest("http://localhost:3000/api/auth/get-session", {
      headers: { "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7", forwarded: "for=203.0.113.7", [TEST_CLIENT_IP_HEADER]: "2001:db8::1" },
    }));
    const h = forwarded[0].headers;
    expect([h.has("x-forwarded-for"), h.has("x-real-ip"), h.has("forwarded")]).toEqual([false, false, false]);
    expect(h.get(TEST_CLIENT_IP_HEADER)).toBe("2001:db8::1");
  });

  it("keeps them when a trusted-proxy list says a proxy in front sets them", async () => {
    forwarded.length = 0;
    vi.stubEnv("CODEDETAILS_AUTH_TRUSTED_PROXIES", "10.0.0.1");
    await GET(new NextRequest("http://localhost:3000/api/auth/get-session", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }));
    expect(forwarded[0].headers.get("x-forwarded-for")).toBe("203.0.113.7, 10.0.0.1");
  });
});
