"use client";

// Who the personal pages (my projects, favorites, graveyard) load data for
// (D02r-c). With Clerk (the default) it passes the page's Clerk values
// through unchanged. With the development Better Auth switch on it uses the
// Better Auth session instead: its own user ID is only the client's cache key
// and "signed in" signal, since the server takes the user from the session
// cookie, and there is no Supabase token to wait for.
import { useAuthBackend } from "@/backend/auth/context";
import { useViewerId } from "./AuthGate";

export function usePersonalPageViewer(clerk: {
  userId: string | null;
  isLoaded: boolean;
  token: string | null;
  tokenLoading: boolean;
}): { userId: string | null; token: string | null; isLoading: boolean } {
  const backend = useAuthBackend();
  const viewerId = useViewerId();
  if (backend === "clerk") {
    return { userId: clerk.userId, token: clerk.token, isLoading: !clerk.isLoaded || clerk.tokenLoading };
  }
  return { userId: viewerId ?? null, token: null, isLoading: viewerId === undefined };
}
