// Picks the login backend (D08b). D08g4a: Better Auth is the default. It is
// used whenever all of these hold, so a production build or a misconfigured
// env can't switch to it:
//   NODE_ENV is "development" (next build/start always run as production; a
//   hosted login is E01's),
//   CODEDETAILS_AUTH_BACKEND is unset, empty or "better-auth",
//   CODEDETAILS_CONVEX_URL and CODEDETAILS_CONVEX_SITE_URL are loopback http
//   URLs (the local backend; any cloud deployment needs Jose's separate approval).
// Otherwise the answer is Clerk, with the reason. CODEDETAILS_AUTH_BACKEND=clerk
// still forces Clerk until the Clerk removal (D08g4f/g); an unknown value
// falls back to Clerk as before.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type AuthBackendChoice =
  | { backend: "clerk"; reason: string }
  | { backend: "better-auth"; convexUrl: string; convexSiteUrl: string };

function loopbackOrigin(value: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    return null;
  }
  return url.protocol === "http:" && LOOPBACK.has(url.hostname) ? url.origin : null;
}

export function chooseAuthBackend(env: Record<string, string | undefined> = process.env): AuthBackendChoice {
  const requested = env.CODEDETAILS_AUTH_BACKEND ?? "";
  if (requested === "clerk") return { backend: "clerk", reason: "CODEDETAILS_AUTH_BACKEND=clerk" };
  if (requested !== "" && requested !== "better-auth") return { backend: "clerk", reason: `unknown backend ${JSON.stringify(requested)}` };
  if (env.NODE_ENV !== "development") return { backend: "clerk", reason: "better-auth is development-only" };
  const convexUrl = loopbackOrigin(env.CODEDETAILS_CONVEX_URL);
  if (!convexUrl) return { backend: "clerk", reason: "CODEDETAILS_CONVEX_URL must be a local http URL" };
  const convexSiteUrl = loopbackOrigin(env.CODEDETAILS_CONVEX_SITE_URL);
  if (!convexSiteUrl) return { backend: "clerk", reason: "CODEDETAILS_CONVEX_SITE_URL must be a local http URL" };
  return { backend: "better-auth", convexUrl, convexSiteUrl };
}

export const betterAuthEnabled = (env: Record<string, string | undefined> = process.env) =>
  chooseAuthBackend(env).backend === "better-auth";
