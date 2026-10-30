// @vitest-environment jsdom
// D08g4e2/D08g4g: useSupabaseToken came from Clerk's session; with Better Auth
// there is none and Clerk is gone, so the token is always null and nothing is
// fetched or cached.
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSupabaseToken } from "@/hooks/use-supabase-token";

describe("useSupabaseToken", () => {
  it("is always null and never loading", async () => {
    const { result } = renderHook(() => useSupabaseToken());
    expect(result.current).toMatchObject({ token: null, loading: false, error: null });
    expect(await result.current.refreshToken()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
