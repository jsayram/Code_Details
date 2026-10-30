// Picks the project read backend (Phase C, C14). Supabase is the only possible
// answer outside development. Convex is used only when all of these hold, so
// a production build or a misconfigured env can't switch:
//   NODE_ENV is "development" (next build/start always run as production),
//   CODEDETAILS_PROJECT_READ_BACKEND is "convex", or unset/empty while the
//   data-default switch (src/backend/data-default.ts, D08g4d) is on,
//   CODEDETAILS_CONVEX_URL is a loopback http URL (the local backend; any
//   cloud deployment needs Jose's separate approval).
// Only the anonymous page read goes through this; every write stays on
// Supabase, so there is no mixed-provider write path.
import { DATA_DEFAULT, type DataBackend } from "@/backend/data-default";
import { convexProjectReader } from "./convex-reader";
import type { ProjectReadBackend } from "./read";
import { supabaseProjectReader } from "./supabase-reader";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type BackendChoice = { backend: "supabase"; reason: string } | { backend: "convex"; url: string };

export function chooseProjectReadBackend(
  env: Record<string, string | undefined> = process.env,
  dataDefault: DataBackend = DATA_DEFAULT,
): BackendChoice {
  const named = env.CODEDETAILS_PROJECT_READ_BACKEND;
  const requested = named === undefined || named === "" ? dataDefault : named;
  if (requested === "supabase") return { backend: "supabase", reason: named ? "CODEDETAILS_PROJECT_READ_BACKEND=supabase" : "default" };
  if (requested !== "convex") return { backend: "supabase", reason: `unknown backend ${JSON.stringify(requested)}` };
  if (env.NODE_ENV !== "development") return { backend: "supabase", reason: "convex read is development-only" };
  let url: URL;
  try {
    url = new URL(env.CODEDETAILS_CONVEX_URL ?? "");
  } catch {
    return { backend: "supabase", reason: "CODEDETAILS_CONVEX_URL missing or invalid" };
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    return { backend: "supabase", reason: "CODEDETAILS_CONVEX_URL must be a local http URL" };
  }
  return { backend: "convex", url: url.origin };
}

let cached: { key: string; reader: ProjectReadBackend } | null = null;

export function getProjectReadBackend(): ProjectReadBackend {
  const choice = chooseProjectReadBackend();
  if (choice.backend === "supabase") return supabaseProjectReader;
  if (cached?.key !== choice.url) cached = { key: choice.url, reader: convexProjectReader(choice.url) };
  return cached.reader;
}
