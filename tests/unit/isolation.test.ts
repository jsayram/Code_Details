import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import dotenv from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import {
  IsolationError,
  SYNTHETIC,
  TEST_DB_PORT,
  isolatedEnv,
  isolationProblems,
} from "../support/isolation";
import { setEnv } from "../../scripts/setEnv";

const base = () => isolatedEnv();
const syntheticPk = (host: string) => `pk_test_${Buffer.from(`${host}$`).toString("base64")}`;

describe("isolation guard", () => {
  it("accepts the harness environment", () => {
    expect(isolationProblems(base())).toEqual([]);
    expect(isolationProblems(isolatedEnv({}, "pw"))).toEqual([]);
  });

  it.each([
    ["DATABASE_URL", "postgresql://postgres:pw@127.0.0.1:54322/postgres", /development port 54322/],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321", /development port 54321/],
    ["DATABASE_URL", "postgresql://postgres:pw@db.example.com:55432/postgres", /non-loopback/],
    ["DATABASE_URL", "postgresql://postgres:pw@127.0.0.1:5432/postgres", /port 55432/],
    ["SITE_URL", "https://codedetails.example.com", /non-loopback/],
    ["STRIPE_SECRET_KEY", "sk_live_abc", /live key|non-synthetic/],
    ["OPENAI_API_KEY", "sk-proj-abc", /non-synthetic/],
    ["GITHUB_TOKEN", "ghp_abc", /non-synthetic/],
    ["DISCORD_WEBHOOK_API_KEY", "https://discord.invalid/x", /non-synthetic/],
    ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", syntheticPk("pet-liger-00.clerk.accounts.dev"), /\.invalid host/],
    ["NEXT_PUBLIC_CONVEX_URL", "https://happy-otter-123.convex.cloud", /must be http:\/\/127\.0\.0\.1:3210|non-loopback/],
    ["CONVEX_URL", "http://127.0.0.1:3211", /must be http:\/\/127\.0\.0\.1:3210/],
    ["CONVEX_DEPLOYMENT", "dev:happy-otter-123", /CONVEX_DEPLOYMENT must not be set/],
    ["CODEDETAILS_CONVEX_SITE_URL", "https://happy-otter-123.convex.site", /must be http:\/\/127\.0\.0\.1:3211/],
    ["CODEDETAILS_CONVEX_SITE_URL", "http://127.0.0.1:3221", /must be http:\/\/127\.0\.0\.1:3211/],
  ])("rejects %s=%s", (name, value, problem) => {
    const problems = isolationProblems({ ...base(), [name]: value });
    expect(problems.join("\n")).toMatch(problem);
  });

  it("allows synthetic Clerk keys whose frontend host is .invalid", () => {
    const env = {
      ...base(),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: syntheticPk("clerk.codedetails.invalid"),
      CLERK_SECRET_KEY: `sk_test_${SYNTHETIC}`,
    };
    expect(isolationProblems(env)).toEqual([]);
  });

  it("requires the isolation flag and NODE_ENV=test", () => {
    const withoutFlag: Record<string, string> = base();
    delete withoutFlag.CODEDETAILS_ENV_ISOLATED;
    expect(isolationProblems(withoutFlag).join()).toMatch(/CODEDETAILS_ENV_ISOLATED/);
    expect(isolationProblems({ ...base(), NODE_ENV: "development" }).join()).toMatch(/NODE_ENV/);
  });

  it("allows NODE_ENV=development only for the dev server, with Next's env loading off", () => {
    expect(isolationProblems(isolatedEnv({}, undefined, { devServer: true }), { devServer: true })).toEqual([]);
    expect(isolationProblems({ ...base(), NODE_ENV: "development" }).join()).toMatch(/NODE_ENV/);
    const noProcessed: Record<string, string> = isolatedEnv({}, undefined, { devServer: true });
    delete noProcessed.__NEXT_PROCESSED_ENV;
    expect(isolationProblems(noProcessed, { devServer: true }).join()).toMatch(/__NEXT_PROCESSED_ENV/);
  });

  it("throws when building an unsafe environment", () => {
    expect(() => isolatedEnv({ DATABASE_URL: "postgresql://u:p@127.0.0.1:54322/postgres" })).toThrow(IsolationError);
  });

  // The repo's real env files must all fail the check. Only names and ports
  // appear in the messages, never values. Skipped where the files don't exist (CI).
  const root = path.resolve(__dirname, "../..");
  const envFiles = [".env.test", ".env.development", ".env.local", ".env.production"].filter((f) =>
    fs.existsSync(path.join(root, f)),
  );
  it.skipIf(envFiles.length === 0).each(envFiles)("rejects %s as a test target", (file) => {
    const parsed = dotenv.parse(fs.readFileSync(path.join(root, file)));
    const problems = isolationProblems({ ...parsed, NODE_ENV: "test", CODEDETAILS_ENV_ISOLATED: "1" });
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("worker environment", () => {
  it("has only synthetic, isolated values", () => {
    expect(isolationProblems(process.env)).toEqual([]);
    expect(process.env.CODEDETAILS_ENV_ISOLATED).toBe("1");
  });
});

describe("setEnv", () => {
  afterEach(() => {
    process.env.CODEDETAILS_ENV_ISOLATED = "1";
  });

  it("loads nothing under the isolated harness", () => {
    const before = { ...process.env };
    setEnv();
    expect(process.env).toEqual(before);
  });

  it("refuses NODE_ENV=test without the harness instead of loading .env.test or .env.local", () => {
    delete process.env.CODEDETAILS_ENV_ISOLATED;
    expect(() => setEnv()).toThrow(/Refusing to load env files/);
  });
});

describe("network guard", () => {
  it.each([
    [54322, "127.0.0.1"],
    [54321, "127.0.0.1"],
    [443, "api.openai.com"],
    // D08a opened 3211 (the test backend's site port); the import backend's
    // ports stay closed, so no test can reach Jose's imported data.
    [3220, "127.0.0.1"],
    [3221, "127.0.0.1"],
    [443, "happy-otter-123.convex.cloud"],
  ])("refuses a socket to %s on %s", (port, host) => {
    expect(() => net.connect({ port, host })).toThrow(IsolationError);
  });

  it("refuses the normalized-array form net.connect() and fetch use", () => {
    expect(() => net.connect({ port: 443, host: "api.openai.com" })).toThrow(IsolationError);
    expect(() => net.createConnection({ port: 54322, host: "127.0.0.1" })).toThrow(IsolationError);
  });

  it("refuses fetch to a loopback port that isn't the test DB or the local Convex backend", async () => {
    await expect(fetch("http://127.0.0.1:3220/")).rejects.toThrow();
    await expect(fetch("http://127.0.0.1:3221/")).rejects.toThrow();
    await expect(fetch("http://127.0.0.1:54321/")).rejects.toThrow();
  });

  it("makes fetch to a provider fail without leaving the machine", async () => {
    await expect(fetch("https://api.stripe.com/v1/charges")).rejects.toThrow();
  });

  it("only ever exposes the test database port to app code", () => {
    const db = process.env.DATABASE_URL;
    if (db) expect(new URL(db).port).toBe(String(TEST_DB_PORT));
  });
});
