// Picks the project read backend (Phase C). Supabase is the only one so far.
import type { ProjectReadBackend } from "./read";
import { supabaseProjectReader } from "./supabase-reader";

export function getProjectReadBackend(): ProjectReadBackend {
  return supabaseProjectReader;
}
