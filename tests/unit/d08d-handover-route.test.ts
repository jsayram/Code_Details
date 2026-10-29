// D08d: the Next.js side of the Clerk-session handover. Clerk's auth() and the
// Better Auth helpers are mocked: browser tests run with synthetic Clerk keys,
// so this is the only place the signed-in-Clerk branch runs. The Convex half
// is tested against the real local backend (d08d-handover.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock calls below are hoisted above this import by Vitest.
import { POST } from "@/app/api/account/handover/route";

const clerk = vi.hoisted(() => ({ userId: null as string | null }));
const helpers = vi.hoisted(() => ({ token: null as string | null, enabled: true }));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: clerk.userId }) }));
vi.mock("@/lib/auth-server", () => ({
  betterAuthServer: async () => (helpers.enabled ? { getToken: async () => helpers.token } : null),
}));

const SWITCH = {
  NODE_ENV: "development",
  CODEDETAILS_AUTH_BACKEND: "better-auth",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
  CODEDETAILS_HANDOVER_SECRET: "s".repeat(43),
};
const APP = "http://localhost:3100";
const post = (origin: string | null = APP) =>
  POST(new Request(`${APP}/api/account/handover`, { method: "POST", headers: origin ? { origin } : {} }));

describe("POST /api/account/handover", () => {
  let saved: Record<string, string | undefined>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(SWITCH).map((k) => [k, process.env[k]]));
    Object.assign(process.env, SWITCH);
    clerk.userId = "user_fixture_a";
    helpers.token = "ba.convex.token";
    helpers.enabled = true;
    fetchMock = vi.fn(async () => Response.json({ linked: true, already: false }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      const env = process.env as Record<string, string | undefined>;
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    vi.unstubAllGlobals();
  });

  it("forwards the verified Clerk subject, the user's token and the secret to Convex's site URL", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3211/account/handover");
    expect(init.headers).toMatchObject({ authorization: "Bearer ba.convex.token", "x-codedetails-handover-secret": SWITCH.CODEDETAILS_HANDOVER_SECRET });
    expect(JSON.parse(init.body as string)).toEqual({ clerkSubject: "user_fixture_a" });
  });

  it("is a 404 while the Better Auth switch is off", async () => {
    process.env.CODEDETAILS_AUTH_BACKEND = "clerk";
    helpers.enabled = false;
    expect((await post()).status).toBe(404);
    process.env.CODEDETAILS_AUTH_BACKEND = "better-auth";
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect((await post()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no Origin", null],
    ["a foreign Origin", "http://evil.synthetic.invalid"],
    ["another port", "http://localhost:3000"],
  ])("refuses %s", async (_name, origin) => {
    expect((await post(origin)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without a Clerk user or without a Better Auth session", async () => {
    clerk.userId = null;
    expect((await post()).status).toBe(401);
    clerk.userId = "user_fixture_a";
    helpers.token = null;
    expect((await post()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the server has no handover secret", async () => {
    delete process.env.CODEDETAILS_HANDOVER_SECRET;
    expect((await post()).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes no Convex reason back to the browser", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ linked: false, reason: "not_linkable" }, { status: 409 }));
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ linked: false });
  });
});
