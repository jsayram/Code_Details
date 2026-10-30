"use client";

// Who the personal pages (my projects, favorites, graveyard) load data for
// (D02r-c). The user comes from the app's login (useViewerId: Clerk's userId,
// or the Better Auth session's; D08g4e3). With Clerk the page's Supabase
// token passes through and is waited for. With Better Auth the user ID is only
// the client's cache key and "signed in" signal, since the server takes the
// user from the session cookie, and there is no Supabase token to wait for.
import { useAuthBackend } from "@/backend/auth/context";
import { useViewerId } from "./AuthGate";

export function usePersonalPageViewer(supabase: {
  token: string | null;
  tokenLoading: boolean;
}): { userId: string | null; token: string | null; isLoading: boolean } {
  const backend = useAuthBackend();
  const viewerId = useViewerId();
  if (backend === "clerk") {
    return { userId: viewerId ?? null, token: supabase.token, isLoading: viewerId === undefined || supabase.tokenLoading };
  }
  return { userId: viewerId ?? null, token: null, isLoading: viewerId === undefined };
}
