// D08g4d made Convex the data default; E03 removed the Supabase fallback and
// the data-default switch with it. Local development reads Convex and, with
// the Better Auth login on the same local Convex, writes it. Anything else
// gets no data backend at all (fail closed), including an old
// CODEDETAILS_PROJECT_READ_BACKEND=supabase.
import path from "node:path";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseProjectReadBackend } from "@/backend/projects";
import { imageReadsFromConvex } from "@/backend/projects/images";
import { DATA_UNAVAILABLE, personalReadsFromConvex, requireConvexData } from "@/backend/projects/personal";
import { projectWritesToConvex } from "@/backend/projects/project-update";

const localDev = {
  NODE_ENV: "development",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
};

describe("data backend: Convex only", () => {
  it("the switch module is gone", async () => {
    await expect(import("@/backend/data-default" as string)).rejects.toThrow();
  });

  it("with no backend named, local development reads and writes Convex", () => {
    expect(chooseProjectReadBackend(localDev)).toEqual({ backend: "convex", url: "http://127.0.0.1:3210" });
    expect(chooseProjectReadBackend({ ...localDev, CODEDETAILS_PROJECT_READ_BACKEND: "" })).toMatchObject({ backend: "convex" });
    expect(personalReadsFromConvex(localDev)).toBe(true);
    expect(projectWritesToConvex(localDev)).toBe(true);
    expect(imageReadsFromConvex(localDev)).toBe(true);
  });

  it("naming Supabase gives no backend, not Supabase", () => {
    const named = { ...localDev, CODEDETAILS_PROJECT_READ_BACKEND: "supabase" };
    expect(chooseProjectReadBackend(named)).toMatchObject({ backend: "none" });
    expect(projectWritesToConvex(named)).toBe(false);
    expect(() => requireConvexData(named)).toThrow(DATA_UNAVAILABLE);
  });

  it.each(["production", "test", undefined])("has no backend with NODE_ENV=%s", (nodeEnv) => {
    expect(chooseProjectReadBackend({ ...localDev, NODE_ENV: nodeEnv })).toMatchObject({ backend: "none" });
    expect(projectWritesToConvex({ ...localDev, NODE_ENV: nodeEnv })).toBe(false);
    expect(() => requireConvexData({ ...localDev, NODE_ENV: nodeEnv })).toThrow(DATA_UNAVAILABLE);
  });

  it.each([
    ["no Convex URLs", {}],
    ["a cloud deployment", { CODEDETAILS_CONVEX_URL: "https://happy-otter-123.convex.cloud" }],
  ])("has no backend with %s", (_name, urls) => {
    const env = { NODE_ENV: "development", ...urls };
    expect(chooseProjectReadBackend(env)).toMatchObject({ backend: "none" });
    expect(projectWritesToConvex(env)).toBe(false);
  });

  it("requireConvexData passes in local development with Better Auth", () => {
    expect(() => requireConvexData(localDev)).not.toThrow();
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

describe("next.config", () => {
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

  it("not when another backend is named, nor outside development", async () => {
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3210");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "supabase");
    expect(await storageHosts()).toEqual([]);
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await storageHosts()).toEqual([]);
  });
});
