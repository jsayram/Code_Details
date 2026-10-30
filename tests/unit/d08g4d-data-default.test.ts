// D08g4d: the data-default switch in the OFF position (mocked here; committed
// on since the D08g4 flip-on). Off is the rollback: an unset
// CODEDETAILS_PROJECT_READ_BACKEND means Supabase. The committed ON position:
// d08g4d-data-default-on.test.ts.
import path from "node:path";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/data-default", () => ({ DATA_DEFAULT: "supabase" }));

import { chooseProjectReadBackend } from "@/backend/projects";
import { imageReadsFromConvex } from "@/backend/projects/images";
import { personalReadsFromConvex } from "@/backend/projects/personal";
import { projectWritesToConvex } from "@/backend/projects/project-update";

// Jose's dev app once it points at a local Convex, with no data backend named.
const localDev = {
  NODE_ENV: "development",
  CODEDETAILS_CONVEX_URL: "http://127.0.0.1:3210",
  CODEDETAILS_CONVEX_SITE_URL: "http://127.0.0.1:3211",
};

describe("data-default switch: off", () => {
  it("an unset or empty backend means Supabase, even with local Convex URLs", () => {
    expect(chooseProjectReadBackend(localDev)).toMatchObject({ backend: "supabase", reason: "default" });
    expect(chooseProjectReadBackend({ ...localDev, CODEDETAILS_PROJECT_READ_BACKEND: "" })).toMatchObject({ backend: "supabase" });
    expect(personalReadsFromConvex(localDev)).toBe(false);
    expect(projectWritesToConvex(localDev)).toBe(false);
    expect(imageReadsFromConvex(localDev)).toBe(false);
  });

  it("naming Convex still opts in, as before", () => {
    const named = { ...localDev, CODEDETAILS_PROJECT_READ_BACKEND: "convex" };
    expect(chooseProjectReadBackend(named)).toEqual({ backend: "convex", url: "http://127.0.0.1:3210" });
    expect(projectWritesToConvex(named)).toBe(true);
  });

  it("the position is a parameter, so both answers come from the same guards", () => {
    expect(chooseProjectReadBackend(localDev, "convex")).toEqual({ backend: "convex", url: "http://127.0.0.1:3210" });
    expect(chooseProjectReadBackend(localDev, "supabase")).toMatchObject({ backend: "supabase" });
  });
});

type RemotePattern = Exclude<NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number], URL>;
/** The repo's next.config, evaluated fresh with the current env. */
const nextConfig = async (): Promise<NextConfig> =>
  ((await import(/* @vite-ignore */ path.resolve(__dirname, "../../next.config.ts"))) as { default: NextConfig }).default;

describe("next.config with the switch off", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows local Convex storage images only when Convex is named", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODEDETAILS_CONVEX_URL", "http://127.0.0.1:3210");
    const hosts = async () => {
      vi.resetModules();
      const config = await nextConfig();
      return (config.images?.remotePatterns ?? []).filter((p: RemotePattern | URL) => "pathname" in p && p.pathname === "/api/storage/**").length;
    };
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "");
    expect(await hosts()).toBe(0);
    vi.stubEnv("CODEDETAILS_PROJECT_READ_BACKEND", "convex");
    expect(await hosts()).toBe(1);
  });
});
