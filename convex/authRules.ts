// Pure auth configuration rules (D08f1). No imports, so unit tests load them
// without the Convex runtime.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether a deployment's site URL is plain http on this machine. */
export function isLoopbackSite(siteUrl: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(siteUrl ?? "");
  } catch {
    return false;
  }
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

/**
 * Email verification is required (Jose, 2026-10-29, 3A). The opt-out
 * CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION="0" is honored only on a
 * loopback backend (CONVEX_SITE_URL is http on 127.0.0.1/localhost), so it
 * can never reach a real deployment. Any other value, or none, means required.
 */
export function emailVerificationRequired(env: Record<string, string | undefined>): boolean {
  if (env.CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION !== "0") return true;
  return !isLoopbackSite(env.CONVEX_SITE_URL);
}

/**
 * SEC-D08-RL: the header the Next.js server sends on its own calls to
 * /api/auth/convex/token, carrying CODEDETAILS_INTERNAL_AUTH_SECRET. Those
 * calls bring no client IP, so without this every user's server-side session
 * check shares one rate-limit bucket. The secret lives only in server env (the
 * Convex deployment and the Next.js server); the app's /api/auth route strips
 * the header from browser requests. It only skips the limiter: the endpoint
 * still needs a valid session cookie.
 */
export const INTERNAL_AUTH_HEADER = "x-codedetails-internal-auth";
export const MIN_INTERNAL_SECRET_LENGTH = 32;

/** Constant-time for equal lengths; the length of a fixed secret isn't a secret. */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Whether a request carries the server's internal secret. False whenever the secret is unset or short. */
export function isInternalAuthCall(given: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_INTERNAL_SECRET_LENGTH || !given) return false;
  return sameSecret(given, secret);
}

/**
 * SEC-D08-RL: the deployment's static JWKS, or undefined while it holds the
 * placeholder "unset" (Convex refuses to deploy an auth config that reads an
 * env var with no value, so tests/convex/push.mjs sets the placeholder, deploys,
 * reads the keys with auth:latestJwks, and deploys again with them).
 */
export function staticJwks(value: string | undefined): string | undefined {
  return value && value.trim().startsWith("[") ? value : undefined;
}
