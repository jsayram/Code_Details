// @vitest-environment jsdom
// D08g4e2: useSupabaseToken asks Clerk's session for a Supabase token only
// when Clerk is the login; with Better Auth it never touches Clerk and has no
// token, so the pages' Better Auth paths (usePersonalPageViewer) decide.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(async () => "clerk-supabase-token-fixture"),
  session: null as null | { getToken: () => Promise<string | null> },
}));
vi.mock("@clerk/nextjs", () => ({
  useSession: () => ({ session: clerk.session, isLoaded: true }),
}));

import { AuthBackendProvider, type AuthBackend } from "@/backend/auth/context";
import { useSupabaseToken } from "@/hooks/use-SupabaseClerkJWTToken";

const wrapper = (backend: AuthBackend) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <AuthBackendProvider backend={backend}>{children}</AuthBackendProvider>;
  };

beforeEach(() => {
  clerk.getToken.mockClear();
  clerk.session = { getToken: clerk.getToken };
  sessionStorage.clear();
});
afterEach(cleanup);

describe("useSupabaseToken", () => {

  it("with Better Auth, never asks Clerk, even if a Clerk session is around", async () => {
    const { result } = renderHook(() => useSupabaseToken(), { wrapper: wrapper("better-auth") });
    await new Promise((r) => setTimeout(r, 20));
    expect(clerk.getToken).not.toHaveBeenCalled();
    expect(result.current.token).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(await result.current.refreshToken(true)).toBeNull();
    expect(clerk.getToken).not.toHaveBeenCalled();
  });
});
