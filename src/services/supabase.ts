import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing required Supabase environment variables");
}

// D08g4f: the Clerk-token clients (createClerkSupabaseClient,
// getAuthenticatedClient) had no callers and are gone; the anonymous client
// is what the app uses.

/**
 * Returns an anonymous Supabase client (no authentication).
 * Use this ONLY for public data access that doesn't require authentication.
 * 
 * @returns {SupabaseClient} - Supabase client without authentication
 * 
 * @example
 * ```typescript
 * const client = getAnonymousClient();
 * const { data } = await client.from('public_projects').select('*');
 * ```
 */
export function getAnonymousClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
