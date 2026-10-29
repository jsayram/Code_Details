// POSTs to Better Auth on the app origin (/api/auth/*) for the D08f3b screens.
// Same-origin JSON only; the response body is returned for its error code.

export interface AuthResult {
  status: number;
  code: string | null;
}

export async function authPost(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const res = await fetch(`/api/auth${path}`, {
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
