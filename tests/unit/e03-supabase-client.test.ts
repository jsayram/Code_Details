// E03 slice 2b: the client-side Supabase code is gone. No anonymous Supabase
// client, no Supabase Storage upload or delete, no Supabase token hook or
// cookie read, no "supabase" upload backend, and no no-op tag-approval stub.
// The pages pass no token; image files go to Convex storage only.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const src = execSync("git ls-files --cached --others --exclude-standard -- src", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/db/"));
const matching = (re: RegExp) => src.filter((f) => re.test(read(f)));

describe("client Supabase code", () => {
  it("the client, storage helpers, token hook and auth-state hook are gone", () => {
    for (const f of ["src/services/supabase.ts", "src/lib/supabase-storage.ts", "src/hooks/use-supabase-token.ts", "src/hooks/use-auth-state.ts"]) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(false);
    }
  });

  it("nothing outside src/db imports a Supabase package or reads its public env or cookie", () => {
    expect(matching(/from ["']@supabase\//)).toEqual([]);
    expect(matching(/NEXT_PUBLIC_SUPABASE_|__supabase_auth_token/)).toEqual([]);
  });

  it("no page takes or passes a Supabase token", () => {
    expect(matching(/useSupabaseToken|use-supabase-token|tokenLoading/)).toEqual([]);
    expect(matching(/<ProjectsProvider[^>]*\btoken=/)).toEqual([]);
    expect(read("src/providers/projects-provider.tsx")).not.toMatch(/^\s*token\??:/m);
    expect(read("src/components/auth/usePersonalPageViewer.ts")).toMatch(/export function usePersonalPageViewer\(\)/);
  });

  it("image uploads have one backend (Convex) and the client deletes no storage file", () => {
    const actions = read("src/app/actions/project-images.ts");
    expect(actions).not.toMatch(/"supabase"|storagePath|storageUrl/);
    const uploader = read("src/components/Projects/ProjectImages/ImageUploader.tsx");
    expect(uploader).not.toMatch(/uploadProjectImage|backend ===/);
    expect(read("src/components/Projects/ProjectImages/ProjectImagesManager.tsx")).not.toMatch(/deleteFromStorage/);
  });

  it("the no-op approveRejectedTagSubmission stub is gone with its caller", () => {
    expect(matching(/approveRejectedTagSubmission/)).toEqual([]);
  });
});
