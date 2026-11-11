// Picks the project read backend (Phase C, C14). E03: the Supabase fallback is
// gone, so the answer is the local Convex backend or nothing. Convex is used
// only when all of these hold, so a production build or a misconfigured env
// can't reach anything else:
//   NODE_ENV is "development" (next build/start always run as production),
//   CODEDETAILS_PROJECT_READ_BACKEND is "convex" or unset/empty,
//   CODEDETAILS_CONVEX_URL is a loopback http URL (the local backend; any
//   cloud deployment needs Jose's separate approval).
// Otherwise the answer is "none" with the reason (fail closed): the public
// reader finds nothing, and the personal reads and writes refuse
// (requireConvexData in ./personal).
import { convexProjectReader } from "./convex-reader";
import type { ProjectReadBackend } from "./read";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type BackendChoice = { backend: "none"; reason: string } | { backend: "convex"; url: string };

export function chooseProjectReadBackend(env: Record<string, string | undefined> = process.env): BackendChoice {
  const named = env.CODEDETAILS_PROJECT_READ_BACKEND ?? "";
  if (named !== "" && named !== "convex") return { backend: "none", reason: `unknown backend ${JSON.stringify(named)} (the Supabase reads were removed in E03)` };
  if (env.NODE_ENV !== "development") return { backend: "none", reason: "convex read is development-only" };
  let url: URL;
  try {
    url = new URL(env.CODEDETAILS_CONVEX_URL ?? "");
  } catch {
    return { backend: "none", reason: "CODEDETAILS_CONVEX_URL missing or invalid" };
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    return { backend: "none", reason: "CODEDETAILS_CONVEX_URL must be a local http URL" };
  }
  return { backend: "convex", url: url.origin };
}

/** With no backend, every project is "not found" (the anonymous read can't tell them apart anyway). */
const noProjectReader: ProjectReadBackend = {
  name: "none",
  getPublicProjectBySlug: async () => null,
  getCurrentSlug: async () => null,
};

let cached: { key: string; reader: ProjectReadBackend } | null = null;

export function getProjectReadBackend(): ProjectReadBackend {
  const choice = chooseProjectReadBackend();
  if (choice.backend === "none") return noProjectReader;
  if (cached?.key !== choice.url) cached = { key: choice.url, reader: convexProjectReader(choice.url) };
  return cached.reader;
}
