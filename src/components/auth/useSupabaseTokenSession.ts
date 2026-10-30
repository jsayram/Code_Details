"use client";

// D08g4e2: the session useSupabaseToken asks for a Supabase token. D08g4f2:
// that was Clerk's session, now gone; with Better Auth there is no Supabase
// token, as before (those reads go through Convex or the anonymous client).
// E03 removes the Supabase token path with its callers.

export interface SupabaseTokenSession {
  session: { getToken: () => Promise<string | null> } | null;
  isLoaded: boolean;
}

export function useSupabaseTokenSession(): SupabaseTokenSession {
  return { session: null, isLoaded: true };
}
