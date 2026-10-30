"use client";

// The Supabase access token the pages pass to their data hooks. It came from
// Clerk's session (D08g4e2: through useSupabaseTokenSession); with Better
// Auth there is none, and D08g4g removed Clerk, so it is always null: those
// reads go through Convex or the anonymous client. Kept so the pages don't
// change until E03 removes the Supabase path.
export function useSupabaseToken(): { token: string | null; loading: boolean; error: Error | null; refreshToken: () => Promise<string | null> } {
  return { token: null, loading: false, error: null, refreshToken: async () => null };
}
