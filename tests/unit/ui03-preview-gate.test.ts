import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("@/lib/admin-action", () => ({ viewerIsAdmin: isAdmin }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("@/app/(administrator)/dashboard/admin/design-foundations/FoundationsGallery", () => ({ FoundationsGallery: () => null }));

import DesignFoundationsPage, { metadata } from "@/app/(administrator)/dashboard/admin/design-foundations/page";

describe("the design foundations preview", () => {
  beforeEach(() => isAdmin.mockResolvedValue(true));
  afterEach(() => vi.unstubAllEnvs());

  it("answers 404 in production, even for an admin, without asking who is signed in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(DesignFoundationsPage()).rejects.toThrow("NOT_FOUND");
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("sends non-admins to the dashboard in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    isAdmin.mockResolvedValue(false);
    await expect(DesignFoundationsPage()).rejects.toThrow("REDIRECT /dashboard");
  });

  it("renders for an admin in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(DesignFoundationsPage()).resolves.toBeTruthy();
  });

  it("asks search engines to stay away", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
