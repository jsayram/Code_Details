// D08f2: SignedIn/SignedOut come from the app. (D08g4g: the old "never from
// @clerk/nextjs" check moved to d08g4g-no-clerk, which covers every import.)
// Client components use AuthGate (waits for hydration); server components use
// AuthGateServer (reads the session on the server, as Clerk's server versions
// did). Mixing them up would either bring back the hydration race or drop
// server-rendered content.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const files = execSync("git ls-files --cached --others --exclude-standard -- src", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const isClient = (text: string) => /^\s*["']use client["'];?/.test(text);

describe("SignedIn/SignedOut imports", () => {
  it("client components never use the server gates", () => {
    const offenders = files.filter((f) => isClient(read(f)) && /from\s*["']@\/components\/auth\/AuthGateServer["']/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the client gates are a client module and the server gates are not", () => {
    expect(isClient(read("src/components/auth/AuthGate.tsx"))).toBe(true);
    expect(isClient(read("src/components/auth/AuthGateServer.tsx"))).toBe(false);
  });

  it("the gates are actually in use (guards against an empty scan)", () => {
    const users = files.filter((f) => /from\s*["']@\/components\/auth\/AuthGate(Server)?["']/.test(read(f)));
    expect(users.length).toBeGreaterThanOrEqual(20);
    expect(users).toEqual(expect.arrayContaining(["src/components/layout/HeaderSectionNoSideBar.tsx", "src/app/projects/[slug]/page.tsx"]));
  });
});
