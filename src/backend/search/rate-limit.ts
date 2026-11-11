// D09 S02b: the search rate limit (S00.3 §10: 10 a second per visitor, bursts
// to 30), as an in-process token bucket. A first line only: each server
// instance counts on its own, and without a trusted proxy the visitor can't be
// told apart, so every caller shares one bucket ("anonymous"). Production needs
// the trusted-proxy client address (CODEDETAILS_AUTH_TRUSTED_PROXIES), or a
// shared limiter, before search is opened there.

export interface Bucket {
  tokens: number;
  at: number;
}

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    readonly ratePerSecond = 10,
    readonly burst = 30,
    readonly maxKeys = 10_000,
  ) {}

  /** Takes one token for key at time now (ms); retryAfter is whole seconds until the next token. */
  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.ratePerSecond);
    b.at = now;
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    if (b.tokens < 1) return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / this.ratePerSecond)) };
    b.tokens -= 1;
    return { ok: true };
  }

  reset() {
    this.buckets.clear();
  }
}

/** The caller's key: the first X-Forwarded-For address only behind a trusted proxy, otherwise one shared key. */
export function clientKey(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (!env.CODEDETAILS_AUTH_TRUSTED_PROXIES?.trim()) return "anonymous";
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? `ip:${first}` : "anonymous";
}
