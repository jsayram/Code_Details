// H1: /api/projects is public, but its personal and session-dependent answers
// must never reach a shared cache. Backends are doubles; nothing connects.
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-server", () => ({ betterAuthSignedIn: async () => true }));
vi.mock("@/backend/projects/owner-edit", () => ({ ownProjectForEdit: async () => null }));
vi.mock("@/backend/projects", () => ({ getProjectReadBackend: () => ({ getPublicProjectBySlug: async () => null }) }));
vi.mock("@/backend/projects/personal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/projects/personal")>()),
  personalReadsFromConvex: () => true,
  convexPersonalList: async () => [],
  convexPublicList: async () => ({ cards: [], total: 0 }),
}));

import { GET } from "@/app/api/projects/route";

const SESSION = "better-auth.session_token=synthetic";
const get = (q: string, cookie?: string) =>
  GET(new NextRequest(`http://localhost:3000/api/projects${q}`, { headers: cookie ? { cookie } : {} }));

describe("/api/projects cache headers", () => {
  it.each([
    ["mine", "?page=1"],
    ["favorites", "?showFavorites=true"],
    ["deleted", "?showDeleted=true"],
    ["a single project", "?slug=fixture-listed"],
    ["the public list with a session", "?showAll=true"],
  ])("%s: private, no-store", async (_name, q) => {
    const res = await get(q, SESSION);
    expect(res.headers.get("cache-control"), q).toBe("private, no-store");
  });

  it("a single project is private even without a session cookie", async () => {
    expect((await get("?slug=fixture-listed")).headers.get("cache-control")).toBe("private, no-store");
  });

  it("the anonymous public list keeps its behaviour (no Cache-Control set)", async () => {
    for (const q of ["?showAll=true", "?showAll=true&tags=react", "?username=someone"]) {
      const res = await get(q);
      expect(res.status, q).toBe(200);
      expect(res.headers.get("cache-control"), q).toBeNull();
    }
  });
});
