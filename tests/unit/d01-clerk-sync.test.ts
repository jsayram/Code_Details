// D01 interim Clerk-era fixes, at the handler level with a recording
// supabase-js double (no network; the B08 socket guard still applies).
//   R18: the webhook verifies the raw signed bytes, answers non-200 when the
//        sync fails so Clerk retries, and logs no payload.
//   R19 (interim part): sync stops overwriting username, names and avatar of
//        an existing profile; the provider only seeds them at creation.
import { Webhook } from "svix";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clerkServerDouble, nextCacheDouble } from "../support/next-doubles";

vi.mock("@clerk/nextjs/server", () => clerkServerDouble);
vi.mock("next/cache", () => nextCacheDouble);

interface Call { table: string; op: string; payload?: unknown }
const db = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; payload?: unknown }[],
  existing: null as Record<string, unknown> | null,
  failWrites: false,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = (op: string, payload?: unknown) => {
        db.calls.push({ table, op, payload });
        const error = op !== "select" && db.failWrites ? { message: "synthetic write failure" } : null;
        const chain = {
          eq: () => chain,
          select: () => chain,
          maybeSingle: async () => ({ data: db.existing, error: null }),
          single: async () => ({ data: error ? null : payload, error }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error }),
        };
        return chain;
      };
      return {
        select: () => result("select"),
        update: (payload: unknown) => result("update", payload),
        insert: (payload: unknown) => result("insert", payload),
        upsert: (payload: unknown) => result("upsert", payload),
        delete: () => result("delete"),
      };
    },
  }),
}));

// Base64 that decodes fine and still carries the SYNTHETIC marker the B08 guard requires.
const SECRET = "whsec_SYNTHETICwebhooksecretAA";
const subject = "user_fixture_a";
const email = "a@synthetic.invalid";
const clerkUser = {
  id: subject,
  first_name: "Provider",
  last_name: "Name",
  username: "provider-username",
  profile_image_url: "https://img.synthetic.invalid/provider.png",
  email_addresses: [{ email_address: email }],
  public_metadata: {},
};
const existingProfile = {
  user_id: subject,
  username: "app-edited-name",
  first_name: "App",
  last_name: "Edited",
  full_name: "App Edited",
  profile_image_url: "https://img.synthetic.invalid/app.png",
  email_address: email,
  tier: "pro",
};

function signed(body: string, secret = SECRET) {
  const id = "msg_synthetic_1";
  const at = new Date();
  return new Request("http://localhost:3100/api/webhook/clerk", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(id, at, body),
    },
  });
}

describe("D01 interim Clerk-era sync fixes", () => {
  let route: typeof import("../../src/app/api/webhook/clerk/route.js");
  let logged: string[];

  beforeAll(async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET;
    // The route imports a Clerk fetch service that refuses to load without a key. Synthetic, never used.
    process.env.CLERK_SECRET_KEY = "sk_test_SYNTHETIC";
    route = await import("../../src/app/api/webhook/clerk/route.js");
  });
  afterAll(() => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    delete process.env.CLERK_SECRET_KEY;
  });

  beforeEach(() => {
    db.calls = [];
    db.existing = { ...existingProfile };
    db.failWrites = false;
    logged = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  describe("R18 webhook", () => {
    it("verifies the exact signed bytes, even when they aren't canonical JSON", async () => {
      // Clerk's whitespace and key order survive; re-serializing would break the signature.
      const body = `{ "type": "user.updated",\n  "data": ${JSON.stringify(clerkUser, null, 1)} }`;
      const res = await route.POST(signed(body));
      expect(res.status).toBe(200);
      expect(db.calls.some((c) => c.op === "update")).toBe(true);
    });

    it("rejects a body changed after signing", async () => {
      const body = JSON.stringify({ type: "user.updated", data: clerkUser });
      const req = signed(body);
      const tampered = new Request(req.url, { method: "POST", headers: req.headers, body: body.replace("Provider", "Mallory") });
      expect((await route.POST(tampered)).status).toBe(400);
      expect(db.calls).toEqual([]);
    });

    it("rejects a signature made with another secret", async () => {
      const body = JSON.stringify({ type: "user.updated", data: clerkUser });
      expect((await route.POST(signed(body, "whsec_SYNTHETICanothersecretA"))).status).toBe(400);
      expect(db.calls).toEqual([]);
    });

    it("answers non-200 when the profile write fails, so Clerk retries", async () => {
      db.failWrites = true;
      const updated = await route.POST(signed(JSON.stringify({ type: "user.updated", data: clerkUser })));
      expect(updated.status).toBe(500);
      db.existing = null;
      const created = await route.POST(signed(JSON.stringify({ type: "user.created", data: clerkUser })));
      expect(created.status).toBe(500);
    });

    it("logs no payload: no email, names or image URL", async () => {
      await route.POST(signed(JSON.stringify({ type: "user.updated", data: clerkUser })));
      db.failWrites = true;
      await route.POST(signed(JSON.stringify({ type: "user.updated", data: clerkUser })));
      const all = logged.join("\n");
      expect(logged.length).toBeGreaterThan(0);
      for (const value of [email, "Provider", "provider-username", clerkUser.profile_image_url]) expect(all).not.toContain(value);
    });

    it("returns only the sync status, never the profile row", async () => {
      const res = await route.POST(signed(JSON.stringify({ type: "user.updated", data: clerkUser })));
      const text = await res.text();
      expect(text).not.toContain(email);
      expect(JSON.parse(text).data).toEqual({ status: "updated" });
    });
  });

  describe("R19 sync no longer overwrites app-owned fields", () => {
    it("an existing profile keeps its username, names and avatar; history is not touched", async () => {
      await route.POST(signed(JSON.stringify({ type: "user.updated", data: clerkUser })));
      const update = db.calls.find((c: Call) => c.table === "profiles" && c.op === "update")!;
      expect(Object.keys(update.payload as object).sort()).toEqual(["email_address", "role", "updated_at"]);
      expect(db.calls.some((c: Call) => c.table === "username_history")).toBe(false);
    });

    it("tier still changes only when the provider sends one", async () => {
      await route.POST(signed(JSON.stringify({ type: "user.updated", data: { ...clerkUser, public_metadata: { tier: "diamond" } } })));
      const update = db.calls.find((c: Call) => c.op === "update")!;
      expect(update.payload).toMatchObject({ tier: "diamond" });
    });

    it("a new profile is still seeded from the provider", async () => {
      db.existing = null;
      await route.POST(signed(JSON.stringify({ type: "user.created", data: clerkUser })));
      const insert = db.calls.find((c: Call) => c.op === "insert")!;
      expect(insert.payload).toMatchObject({
        user_id: subject,
        username: "provider-username",
        first_name: "Provider",
        last_name: "Name",
        profile_image_url: clerkUser.profile_image_url,
      });
    });
  });
});
