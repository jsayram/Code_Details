// What the sign-in error screen says for each code Better Auth (or the
// opaque email link, convex/emailLinks.ts) puts in ?error= (D08f3b). Only the
// code picks the wording; error_description and the code itself are never
// shown, so nothing in the URL reaches the page as text.

export type AuthErrorKind = "account_not_linked" | "link" | "restart" | "generic";

const LINK = new Set(["invalid_link", "invalid_token", "token_expired"]);
const RESTART = new Set([
  "state_mismatch",
  "state_not_found",
  "invalid_state",
  "please_restart_the_process",
  "no_code",
  "no_callback_url",
  "invalid_callback_request",
  "access_denied",
]);

export function authErrorKind(code: string | null | undefined): AuthErrorKind {
  const c = (code ?? "").toLowerCase();
  if (c === "account_not_linked") return "account_not_linked";
  if (LINK.has(c)) return "link";
  if (RESTART.has(c)) return "restart";
  return "generic";
}

export const AUTH_ERROR_TEXT: Record<AuthErrorKind, { title: string; body: string }> = {
  // f3 (D08e decision 4A): neutral, and no lookup by email.
  account_not_linked: {
    title: "Sign in with your password",
    body: "This email is already used by a Code Details account. Sign in with your password, then connect GitHub from your settings.",
  },
  // f6: mail apps that check links can open them before you do.
  link: {
    title: "This link has expired or was already used",
    body: "Links work once and expire after an hour. Some mail apps open links ahead of you to check them, which can use them up. Enter your email and we'll send a new one.",
  },
  restart: {
    title: "Let's start that again",
    body: "The sign-in took too long or was started in another tab. Please try again.",
  },
  generic: {
    title: "Something went wrong",
    body: "We couldn't finish signing you in. Please try again.",
  },
};

/** A same-site path to go to after signing in; anything else becomes "/". */
export function safeRedirect(value: string | null | undefined): string {
  if (!value) return "/";
  const base = typeof window !== "undefined" ? window.location.origin : "http://same-site.invalid";
  try {
    // Clerk-era links pass a full URL on this origin; keep only its path.
    const url = new URL(value, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
