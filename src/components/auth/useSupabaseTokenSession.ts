"use client";

// D08g4e2: the session useSupabaseToken asks for a Supabase token. With Clerk
// it is Clerk's session (unchanged); with Better Auth there is no Clerk
// session and so no Supabase token, as before (those reads go through Convex
// or the anonymous client). g4g removes the Clerk branch.
import { useSession } from "@clerk/nextjs";
import { useAuthBackend } from "@/backend/auth/context";

export interface SupabaseTokenSession {
  session: { getToken: () => Promise<string | null> } | null;
  isLoaded: boolean;
}

export function useSupabaseTokenSession(): SupabaseTokenSession {
  const backend = useAuthBackend();
  const { session, isLoaded } = useSession();
  if (backend !== "clerk") return { session: null, isLoaded: true };
  return { session: session ?? null, isLoaded };
}
