"use client";

// Who the personal pages (my projects, favorites, graveyard) load data for
// (D02r-c). The user comes from the Better Auth session (useViewerId). The
// user ID is only the client's cache key and "signed in" signal, since the
// server takes the user from the session cookie, and there is no Supabase
// token to wait for. D08g4f2: the Clerk branch (with its Supabase token) is
// gone; the argument stays so the pages don't change until E03.
import { useViewerId } from "./AuthGate";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function usePersonalPageViewer(_supabase: {
  token: string | null;
  tokenLoading: boolean;
}): { userId: string | null; token: string | null; isLoading: boolean } {
  const viewerId = useViewerId();
  return { userId: viewerId ?? null, token: null, isLoading: viewerId === undefined };
}
