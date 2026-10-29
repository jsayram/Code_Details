// Username rules (D04b, P08 R22; P07 §5.2, §5.3). Pure module shared by the
// Supabase profile edit and the Convex mutation, so both backends accept and
// refuse the same names. ASCII only (decided by Jose, 2026-10-28): letters,
// digits, "_" and "-", 3–30 characters, starting and ending with a letter or
// digit, compared case-insensitively, never a reserved name.
import { usernameKey } from "./public-profile";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
const KEY_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const ASCII_NAME = /^[A-Za-z0-9_-]+$/;

/** A previous name stays reserved for its user, and redirects to them, this long. */
export const USERNAME_RESERVATION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Route segments and system words nobody may take. Generated handles
 * (`user-xxxxxx`) are ordinary names: uniqueness alone protects them.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "about", "account", "accounts", "admin", "administrator", "anonymous", "api", "app", "auth", "categories",
  "codedetails", "code-details", "dashboard", "deleted", "docs", "edit", "favorites", "help", "home", "login",
  "logout", "me", "moderator", "new", "null", "output", "privacy", "profile", "profiles", "projects", "root",
  "search", "settings", "shared-projects", "sign-in", "sign-out", "sign-up", "signin", "signout", "signup",
  "support", "system", "tags", "terms", "test-cache", "undefined", "user", "users",
]);

export type UsernameCheck =
  | { ok: true; username: string; key: string }
  | { ok: false; message: string };

/** The display form (trimmed, NFKC) and its key, or why the name can't be used. */
export function checkUsername(raw: string): UsernameCheck {
  const username = raw.trim().normalize("NFKC");
  if (!username) return { ok: false, message: "Username is required" };
  if (!ASCII_NAME.test(username)) {
    return { ok: false, message: "Username can only contain letters, numbers, underscores and hyphens" };
  }
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return { ok: false, message: `Username must be ${USERNAME_MIN} to ${USERNAME_MAX} characters` };
  }
  const key = usernameKey(username);
  if (!KEY_PATTERN.test(key)) return { ok: false, message: "Username must start and end with a letter or number" };
  if (RESERVED_USERNAMES.has(key)) return { ok: false, message: "That username is reserved" };
  return { ok: true, username, key };
}

export const USERNAME_TAKEN_MESSAGE = "That username is taken";
