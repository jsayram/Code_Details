// Auth emails (D08e): verification and password reset. No email package: one
// HTTP POST in Mailpit's send-API format (/api/v1/send), to
// CODEDETAILS_EMAIL_HTTP_URL, accepted only when it is a loopback http URL.
// So in development mail goes to a local Mailpit (or, in tests, a fake
// receiver) and nowhere else. A real sender is chosen at launch (Jose,
// 2026-10-28). Without an endpoint nothing is sent. Logs never carry the
// address, the link or the token.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type AuthEmailKind = "verify-email" | "reset-password";

const SUBJECTS: Record<AuthEmailKind, string> = {
  "verify-email": "Confirm your email for Code Details",
  "reset-password": "Reset your Code Details password",
};

const BODIES: Record<AuthEmailKind, (url: string) => string> = {
  "verify-email": (url) => `Confirm your email address for Code Details:\n\n${url}\n\nThe link works for one hour. If you didn't sign up, ignore this email.`,
  "reset-password": (url) => `Reset your Code Details password:\n\n${url}\n\nThe link works for one hour. If you didn't ask for this, ignore this email; your password stays the same.`,
};

export function emailEndpoint(value: string | undefined = process.env.CODEDETAILS_EMAIL_HTTP_URL): string | null {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    return null;
  }
  return url.protocol === "http:" && LOOPBACK.has(url.hostname) ? url.toString() : null;
}

export async function sendAuthEmail(kind: AuthEmailKind, to: string, url: string): Promise<void> {
  const endpoint = emailEndpoint();
  if (!endpoint) {
    console.warn(`[auth-email] ${kind}: not sent, no local email endpoint configured`);
    return;
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: process.env.CODEDETAILS_EMAIL_FROM ?? "no-reply@codedetails.invalid", Name: "Code Details" },
        To: [{ Email: to }],
        Subject: SUBJECTS[kind],
        Text: BODIES[kind](url),
        Tags: [kind],
      }),
    });
    if (!res.ok) console.warn(`[auth-email] ${kind}: endpoint answered ${res.status}`);
  } catch {
    // Sign-up and reset requests still succeed; the user can ask again.
    console.warn(`[auth-email] ${kind}: endpoint unreachable`);
  }
}
