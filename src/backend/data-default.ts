// D08g4d: the data-default switch. What an unset (or empty)
// CODEDETAILS_PROJECT_READ_BACKEND means: "supabase" (off) or "convex" (on).
//
// OFF until Jose decides which data Convex starts from. Turning it on is this
// one line; with it on, Convex is the default for the project/profile reads,
// and the writes follow (projectWritesToConvex: a Better Auth login on the
// same local Convex). The same guards still apply either way: Convex only in
// development, only with a loopback CODEDETAILS_CONVEX_URL; otherwise
// Supabase. CODEDETAILS_PROJECT_READ_BACKEND=supabase or =convex still wins.
// Report: Agent Planning/phase-d08/D08G4_LATE_FLIP_REPORT.md (g4d).
export type DataBackend = "supabase" | "convex";

export const DATA_DEFAULT: DataBackend = "supabase";
