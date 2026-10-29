// Public profile contract (D04a, P08 R07; P07 §3.3, §5.5, §8). What anyone may
// see of a profile: the username (never an email), the full name, the avatar
// and the dates. Never the email, the provider subject (`user_id`), the
// profile UUID, the role or the tier. The Supabase routes return the legacy
// snake_case row the pages already read; the Convex query returns the
// camelCase shape. Both are checked before they leave the server, so a leak
// fails loudly instead of reaching the browser. Pure module (Convex imports it).

const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;
const EMAIL_GLOBAL = /([^\s@"]+)@[^\s@"]+\.[^\s@"]+/g;
const PROVIDER_SUBJECT = /\buser_[A-Za-z0-9_]+/;

/**
 * Some legacy profiles use their email address as the username. Publish only
 * the part before the "@", which is what the pages showed before Phase C.
 * Convex has no such usernames: its import gives them generated handles
 * (P07 §5.2).
 */
/** Canonical username key (P07 §5.2): trim, NFKC, lowercase. */
export const usernameKey = (s: string) => s.trim().normalize("NFKC").toLowerCase();

export const publicUsername = (username: string) => (username.includes("@") ? username.split("@")[0] : username);

/** A name field with any email address in it cut down to the address's local part. */
const publicName = (name: string | null) => (name === null ? null : name.replace(EMAIL_GLOBAL, "$1"));

export const PUBLIC_PROFILE_ROW_KEYS = ["username", "full_name", "profile_image_url", "created_at", "updated_at"] as const;
export const PUBLIC_PROFILE_KEYS = ["username", "fullName", "avatarUrl", "createdAt", "updatedAt"] as const;

/** The legacy row shape the profile pages and the user directory read. */
export interface PublicProfileRow {
  username: string;
  full_name: string | null;
  profile_image_url: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

/** The Convex answer (dates are ISO 8601, UTC). */
export interface PublicProfile {
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function assertOnly(value: unknown, allowed: readonly string[], identity: readonly string[], what: string) {
  if (!value || typeof value !== "object") throw new Error(`${what}: not an object`);
  const obj = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) problems.push(`${key} is not public`);
  for (const key of allowed) if (!Object.hasOwn(obj, key)) problems.push(`${key} is missing`);
  for (const key of identity) {
    const v = obj[key];
    if (typeof v !== "string") continue;
    if (EMAIL.test(v)) problems.push(`${key} contains an email address`);
    if (PROVIDER_SUBJECT.test(v)) problems.push(`${key} contains a provider subject`);
  }
  if (problems.length) throw new Error(`${what} contract violated:\n- ${problems.join("\n- ")}`);
}

export function assertPublicProfileRow(value: unknown): asserts value is PublicProfileRow {
  assertOnly(value, PUBLIC_PROFILE_ROW_KEYS, ["username", "full_name"], "public profile row");
}

export function assertPublicProfile(value: unknown): asserts value is PublicProfile {
  assertOnly(value, PUBLIC_PROFILE_KEYS, ["username", "fullName"], "public profile");
}

/** Picks the public fields of a Supabase profile row (whatever else it carries) and checks them. */
export function toPublicProfileRow(row: {
  username: string;
  full_name: string | null;
  profile_image_url: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}): PublicProfileRow {
  const out: PublicProfileRow = {
    username: publicUsername(row.username),
    full_name: publicName(row.full_name),
    profile_image_url: row.profile_image_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  assertPublicProfileRow(out);
  return out;
}

/** The Convex answer in the legacy row shape, for the routes that serve both backends. */
export function rowFromPublicProfile(p: PublicProfile): PublicProfileRow {
  const out: PublicProfileRow = {
    username: p.username,
    full_name: p.fullName,
    profile_image_url: p.avatarUrl,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
  assertPublicProfileRow(out);
  return out;
}
