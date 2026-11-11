"use server";

// DEF-G4E3-HANDLE: the dashboard's profile editor saves to
// /api/profiles/<handle>. With Better Auth the client has no handle, so it asks
// here for the session's own one, from Convex (identity:whoami), the store
// that PUT writes to. No arguments: the handle can only be the caller's. Null
// when signed out, with no local Convex (E03: no Supabase fallback), or on any error.
import { getMyShareUsername } from "./share";

export async function getMyProfileHandle(): Promise<string | null> {
  return getMyShareUsername();
}
