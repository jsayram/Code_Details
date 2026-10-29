// SEC-D08-RL: the /api/auth route removes the server's internal header from
// browser requests before forwarding them to the auth site.
import { describe, expect, it, vi } from "vitest";
import { INTERNAL_AUTH_HEADER } from "../../convex/authRules";
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
    await GET(new Request("http://localhost:3000/api/auth/convex/token", { headers: { [INTERNAL_AUTH_HEADER]: secret, cookie: "a=b" } }));
    await POST(new Request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { [INTERNAL_AUTH_HEADER]: secret, "content-type": "application/json" }, body: "{}" }));
    expect(forwarded.map((r) => r.headers.has(INTERNAL_AUTH_HEADER))).toEqual([false, false]);
    expect(forwarded[0].headers.get("cookie")).toBe("a=b");
    expect(await forwarded[1].text()).toBe("{}");
  });
});
