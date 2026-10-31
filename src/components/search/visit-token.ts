// D10 day one: the browser's random visit token for search analytics (S00.3
// §7). Never derived from the account; renewed after 30 minutes idle and at
// midnight UTC; none at all when the browser sends Global Privacy Control or
// Do Not Track. Storage can be blocked or empty, so every access is guarded
// and a failure just means no token (no analytics), never a broken page.

const KEY = "cd-search-visit";
const IDLE_MS = 30 * 60 * 1000;

function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The current visit token, renewing it when it is stale; null when opted out or storage is unavailable. */
export function visitToken(now = Date.now()): string | null {
  if (optedOut()) return null;
  try {
    const day = new Date(now).toISOString().slice(0, 10);
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { token: string; at: number; day: string } | null;
    const token = saved && saved.day === day && now - saved.at < IDLE_MS ? saved.token : randomToken();
    localStorage.setItem(KEY, JSON.stringify({ token, at: now, day }));
    return token;
  } catch {
    return null;
  }
}
