// D08g4d: the data-default switch in the ON position (mocked here; committed
// off). Convex becomes the default for reads and, with the Better Auth login
// on the same local Convex, writes. Everything outside local development stays
// on Supabase, and naming Supabase still wins.
import path from "node:path";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/data-default", () => ({ DATA_DEFAULT: "convex" }));

import { chooseProjectReadBackend } from "@/backend/projects";
import { imageReadsFromConvex } from "@/backend/projects/images";
import { personalReadsFromConvex } from "@/backend/projects/personal";
import { projectWritesToConvex } from "@/backend/projects/project-update";

const localDev = {
  NODE_ENV: "development",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
};

describe("data-default switch: on", () => {
  it("with no backend named, local development reads and writes Convex", () => {
    expect(chooseProjectReadBackend(localDev)).toEqual({ backend: "convex", url: "http://127.0.0.1:3210" });
    expect(chooseProjectReadBackend({ ...localDev, CODEDETAILS_PROJECT_READ_BACKEND: "" })).toMatchObject({ backend: "convex" });
    expect(personalReadsFromConvex(localDev)).toBe(true);
    expect(projectWritesToConvex(localDev)).toBe(true);
    expect(imageReadsFromConvex(localDev)).toBe(true);
  });

  it("naming Supabase keeps Supabase", () => {
    const named = { ...localDev, CODEDETAILS_PROJECT_READ_BACKEND: "supabase" };
    expect(chooseProjectReadBackend(named)).toMatchObject({ backend: "supabase", reason: "CODEDETAILS_PROJECT_READ_BACKEND=supabase" });
    expect(projectWritesToConvex(named)).toBe(false);
  });

  it.each(["production", "test", undefined])("stays on Supabase with NODE_ENV=%s", (nodeEnv) => {
    expect(chooseProjectReadBackend({ ...localDev, NODE_ENV: nodeEnv })).toMatchObject({ backend: "supabase" });
    expect(projectWritesToConvex({ ...localDev, NODE_ENV: nodeEnv })).toBe(false);
  });

  it.each([
    ["no Convex URLs (Jose's dev app today)", {}],
    ["a cloud deployment", { CODEDETAILS_CONVEX_URL: "https://happy-otter-123.convex.cloud" }],
  ])("stays on Supabase with %s", (_name, urls) => {
    const env = { NODE_ENV: "development", ...urls };
    expect(chooseProjectReadBackend(env)).toMatchObject({ backend: "supabase" });
    expect(projectWritesToConvex(env)).toBe(false);
  });

  it("writes need the Better Auth login on the same local Convex", () => {
    expect(projectWritesToConvex({ ...localDev, CODEDETAILS_AUTH_BACKEND: "clerk" })).toBe(false);
    expect(projectWritesToConvex({ ...localDev, CODEDETAILS_CONVEX_SITE_URL: undefined })).toBe(false);
  });
});

type RemotePattern = Exclude<NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number], URL>;
/** The repo's next.config, evaluated fresh with the current env. */
const nextConfig = async (): Promise<NextConfig> =>
  ((await import(/* @vite-ignore */ path.resolve(__dirname, "../../next.config.ts"))) as { default: NextConfig }).default;

describe("next.config with the switch on", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const storageHosts = async () => {
    vi.resetModules();
    const config = await nextConfig();
    return (config.images?.remotePatterns ?? []).filter((p: RemotePattern | URL) => "pathname" in p && p.pathname === "/api/storage/**");
  };

  it("allows the local Convex storage images when no backend is named (D06 under the default)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "");
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3210");
    expect(await storageHosts()).toEqual([expect.objectContaining({ hostname: "127.0.0.1", port: "3210" })]);
  });

  it("not when Supabase is named, nor outside development", async () => {
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3210");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
    expect(await storageHosts()).toEqual([]);
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await storageHosts()).toEqual([]);
  });
});
