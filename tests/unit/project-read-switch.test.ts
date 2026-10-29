// C14: the development-only project read switch. Supabase by default and
// always outside development; Convex only for a local URL in development.
import { describe, expect, it } from "vitest";
import { chooseProjectReadBackend } from "@/backend/projects";

const dev = { NODE_ENV: "development", CODEDETAILS_PROJECT_READ_BACKEND: "convex", CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210" };

describe("project read backend switch", () => {
  it("defaults to Supabase with nothing set", () => {
    expect(chooseProjectReadBackend({})).toMatchObject({ backend: "supabase", reason: "default" });
    expect(chooseProjectReadBackend({ NODE_ENV: "development" })).toMatchObject({ backend: "supabase" });
  });

  it("uses Convex only in development with a local URL", () => {
    expect(chooseProjectReadBackend(dev)).toEqual({ backend: "convex", url: "http://127.0.0.1:3210" });
    expect(chooseProjectReadBackend({ ...dev, CODEDETAILS_CONVEX_URL: "http://localhost:3210/" })).toMatchObject({ backend: "convex" });
  });

  it.each(["production", "test", undefined, "Development", "dev"])("can't be enabled with NODE_ENV=%s", (nodeEnv) => {
    expect(chooseProjectReadBackend({ ...dev, NODE_ENV: nodeEnv })).toMatchObject({ backend: "supabase" });
  });

  it.each([
    ["a cloud deployment", "https://happy-otter-123.convex.cloud"],
    ["https on loopback", "https://127.0.0.1:3210"],
    ["a LAN address", "http://192.168.1.20:3210"],
    ["a lookalike host", "http://127.0.0.1.example.com:3210"],
    ["no URL", ""],
    ["garbage", "not a url"],
  ])("refuses %s", (_name, url) => {
    expect(chooseProjectReadBackend({ ...dev, CODEDETAILS_CONVEX_URL: url })).toMatchObject({ backend: "supabase" });
  });

  it.each(["CONVEX", "convex ", "true", "1"])("ignores the near-miss value %j", (value) => {
    expect(chooseProjectReadBackend({ ...dev, CODEDETAILS_PROJECT_READ_BACKEND: value })).toMatchObject({ backend: "supabase" });
  });

  it("is used only by the anonymous page read: no Convex import in any write path", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync("git grep -l --untracked -e convex-reader -e 'convex/browser' -- src", { encoding: "utf8" }).trim().split("\n").sort();
    // D04a: the anonymous public profile read is the only addition; it calls
    // one public query and writes nothing.
    expect(hits).toEqual(["src/backend/profiles/read.ts", "src/backend/projects/convex-reader.ts", "src/backend/projects/index.ts"]);
  });
});
