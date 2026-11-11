// POSTs to Better Auth on the app origin (/api/auth/*) for the D08f3b screens.
// Same-origin JSON only; the response body is returned for its error code.

export interface AuthResult {
  status: number;
  code: string | null;
}

export const authPost = (path: string, body: Record<string, unknown>) => postJson(`/api/auth${path}`, body);

/** A same-origin JSON POST; the status and any error code. */
export async function postJson(url: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { code?: string } | null;
    return { status: res.status, code: data?.code ?? null };
  } catch {
    return { status: 0, code: null };
  }
}

export const VERIFIED_CALLBACK = "/sign-in?verified=1";
export const RESET_PATH = "/sign-in/reset-password";

export const sendVerificationLink = (email: string) => authPost("/send-verification-email", { email, callbackURL: VERIFIED_CALLBACK });

/**
 * Starts GitHub sign-in (or, with `link`, connecting GitHub to the signed-in
 * account) and goes to GitHub. Returns a message when it can't.
 */
export async function startGitHub({ link = false, callbackURL }: { link?: boolean; callbackURL: string }): Promise<string | null> {
  try {
    const res = await fetch(`/api/auth/${link ? "link-social" : "sign-in/social"}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL, errorCallbackURL: "/sign-in/error", disableRedirect: true }),
    });
    const data = (await res.json().catch(() => null)) as { url?: string; code?: string } | null;
    if (res.ok && data?.url && new URL(data.url).protocol === "https:") {
      window.location.assign(data.url);
      return null;
    }
    if (res.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (res.status === 401) return "Sign in first.";
    if (res.status === 404 || data?.code === "PROVIDER_NOT_FOUND") return "GitHub sign-in isn't available here.";
    return "We couldn't reach GitHub. Please try again.";
  } catch {
    return "We couldn't reach the server. Check your connection and try again.";
  }
}
