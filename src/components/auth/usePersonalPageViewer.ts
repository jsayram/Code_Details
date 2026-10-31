"use client";

// Who the personal pages (my projects, favorites, graveyard) load data for
// (D02r-c). The user comes from the Better Auth session (useViewerId). The
// user ID is only the client's cache key and "signed in" signal, since the
// server takes the user from the session cookie. D08g4f2 removed the Clerk
// branch; E03 removed the Supabase token argument the pages still passed.
import { useViewerId } from "./AuthGate";

export function usePersonalPageViewer(): { userId: string | null; isLoading: boolean } {
  const viewerId = useViewerId();
  return { userId: viewerId ?? null, isLoading: viewerId === undefined };
}
