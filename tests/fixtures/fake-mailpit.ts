// A stand-in for Mailpit's POST /api/v1/send (D08e), listening where
// tests/convex/push.mjs points the test backend's auth emails
// (127.0.0.1:3299). Shared by the Vitest and Playwright suites (D08f1).
import http from "node:http";

export const FAKE_MAILPIT_PORT = 3299;

export interface Mail {
  to: string;
  subject: string;
  text: string;
  tags: string[];
  from: string;
}

export function fakeMailpit() {
  const inbox: Mail[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/api/v1/send") {
        res.writeHead(404).end();
        return;
      }
      const m = JSON.parse(raw) as { From: { Email: string }; To: { Email: string }[]; Subject: string; Text: string; Tags?: string[] };
      inbox.push({ from: m.From.Email, to: m.To[0].Email, subject: m.Subject, text: m.Text, tags: m.Tags ?? [] });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ID: `synthetic-${inbox.length}` }));
    });
  });
  const mailFor = (to: string, tag: string) => inbox.filter((m) => m.to === to && m.tags.includes(tag));
  return {
    inbox,
    server,
    mailFor,
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(FAKE_MAILPIT_PORT, "127.0.0.1", () => resolve());
      }),
    stop: () => new Promise((resolve) => server.close(resolve)),
    async waitFor(to: string, tag: string, count = 1): Promise<Mail[]> {
      for (let i = 0; i < 50; i++) {
        if (mailFor(to, tag).length >= count) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return mailFor(to, tag);
    },
  };
}

export const linkIn = (mail: Mail) => new URL(/(http:\/\/\S+)/.exec(mail.text)![1]);

/**
 * Whether a URL or log text reveals the address: plainly, URL-encoded, or
 * inside a JWT (decoded, as Better Auth's verification token carries it).
 */
export function revealsAddress(text: string, email: string): boolean {
  const lower = text.toLowerCase();
  const target = email.toLowerCase();
  for (const form of [target, encodeURIComponent(target), target.replace("@", "%40")]) {
    if (lower.includes(form.toLowerCase())) return true;
  }
  for (const [, payload] of text.matchAll(/eyJ[A-Za-z0-9_-]*\.([A-Za-z0-9_-]+)/g)) {
    try {
      if (Buffer.from(payload, "base64url").toString("utf8").toLowerCase().includes(target)) return true;
    } catch {
      // not base64url after all
    }
  }
  return false;
}
