// E03 slice 3: Drizzle, src/db and the Supabase JS client are gone. The row
// types the app still uses live in src/types/rows.ts and
// src/types/project-images.ts. postgres stays for the test harness only (the
// isolated test database the Supabase fixture and policy tests use), and the
// supabase CLI stays a devDependency while Jose runs his local stack with it.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const files = (dirs: string) =>
  execSync(`git ls-files --cached --others --exclude-standard -- ${dirs}`, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|cjs|js)$/.test(f) && !f.includes("/_generated/"));
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> };
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

describe("Drizzle and the Supabase client", () => {
  it("src/db and the Drizzle config are gone", () => {
    expect(fs.existsSync(path.join(root, "src/db"))).toBe(false);
    expect(fs.existsSync(path.join(root, "drizzle.config.ts"))).toBe(false);
  });

  it("package.json has no drizzle or @supabase package and no db:* script", () => {
    expect(deps.filter((d) => /drizzle|^@supabase\//.test(d))).toEqual([]);
    expect(Object.keys(pkg.scripts).filter((s) => s.startsWith("db:"))).toEqual([]);
  });

  it("nothing imports drizzle, @supabase/* or @/db", () => {
    const hits = files("src convex scripts tests").filter((f) =>
      /from ["'](drizzle-orm|drizzle-kit|@supabase\/[^"']+|@\/db(\/[^"']*)?)["']|require\(["']drizzle/.test(read(f)),
    );
    expect(hits).toEqual([]);
  });

  it("postgres is used by the test harness only, never by app code", () => {
    const appHits = files("src convex").filter((f) => /from ["']postgres["']/.test(read(f)));
    expect(appHits).toEqual([]);
  });
});
