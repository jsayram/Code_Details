// Pure seeding rules for new accounts (D08c, P07 §5.2, §5.4, §5.12). No imports,
// so unit tests can load them without the Convex runtime or generated API.

/** §5.12: hosts an external avatar may come from (Clerk-era, Gravatar, GitHub). */
export const AVATAR_HOSTS = new Set(["img.clerk.com", "gravatar.com", "www.gravatar.com", "avatars.githubusercontent.com"]);
export const MAX_NAME_LENGTH = 100;
const HANDLE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** The provider name as a public full name, or undefined when it shouldn't be shown. */
export function seedFullName(name: string | null | undefined, email: string | null | undefined): string | undefined {
  if (!name) return undefined;
  // Drop control and format characters, collapse whitespace.
  const cleaned = name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  // Never let an address become a public name (P07 §5.5).
  if (cleaned.includes("@")) return undefined;
  if (email && cleaned.toLowerCase() === email.trim().toLowerCase()) return undefined;
  return [...cleaned].slice(0, MAX_NAME_LENGTH).join("");
}

/** The provider image as an external avatar, only for https on an allowed host. */
export function seedAvatar(image: string | null | undefined): { kind: "external"; url: string } | undefined {
  if (!image) return undefined;
  let url: URL;
  try {
    url = new URL(image);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
  if (!AVATAR_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  return { kind: "external", url: url.toString() };
}

export function randomHandle(): string {
  // Rejection sampling: 252 = 7 × 36, so bytes 252–255 would bias a % 36.
  let out = "";
  const bytes = new Uint8Array(12);
  while (out.length < 6) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < 252 && out.length < 6) out += HANDLE_ALPHABET[b % 36];
  }
  return `user-${out}`;
}
