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
