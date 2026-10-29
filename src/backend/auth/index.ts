// Picks the login backend (D08b). Clerk is the default and the only possible
// answer outside development. Better Auth's /api/auth routes and server helpers
// switch on only when all of these hold, so a production build or a
// misconfigured env can't switch:
//   NODE_ENV is "development" (next build/start always run as production),
//   CODEDETAILS_AUTH_BACKEND is exactly "better-auth",
//   CODEDETAILS_CONVEX_URL and CODEDETAILS_CONVEX_SITE_URL are loopback http
//   URLs (the local backend; any cloud deployment needs Jose's separate approval).
// Clerk keeps running either way until D08g; this only decides whether the
// Better Auth routes exist.
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
  const requested = env.CODEDETAILS_AUTH_BACKEND;
  if (requested === undefined || requested === "" || requested === "clerk") return { backend: "clerk", reason: "default" };
  if (requested !== "better-auth") return { backend: "clerk", reason: `unknown backend ${JSON.stringify(requested)}` };
  if (env.NODE_ENV !== "development") return { backend: "clerk", reason: "better-auth is development-only" };
  const convexUrl = loopbackOrigin(env.CODEDETAILS_CONVEX_URL);
  if (!convexUrl) return { backend: "clerk", reason: "CODEDETAILS_CONVEX_URL must be a local http URL" };
  const convexSiteUrl = loopbackOrigin(env.CODEDETAILS_CONVEX_SITE_URL);
  if (!convexSiteUrl) return { backend: "clerk", reason: "CODEDETAILS_CONVEX_SITE_URL must be a local http URL" };
  return { backend: "better-auth", convexUrl, convexSiteUrl };
}

export const betterAuthEnabled = (env: Record<string, string | undefined> = process.env) =>
  chooseAuthBackend(env).backend === "better-auth";
