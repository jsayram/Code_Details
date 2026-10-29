// Public profile read on Convex (D04a, P08 R07; P07 §3.3, §5.3, §8). Anonymous
// by design: no identity argument, and it never returns users, emails, roles,
// tiers or provider subjects. A profile is public unless its account is
// deleting or deleted (then it looks missing). A previous username inside its
// 90-day reservation redirects to the holder's current name; after that it
// resolves to nothing until someone claims it.
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { type PublicProfile, assertPublicProfile, usernameKey } from "../src/backend/profiles/public-profile";
import { USERNAME_RESERVATION_MS, USERNAME_TAKEN_MESSAGE, checkUsername } from "../src/backend/profiles/username-rules";
import { MAX_NAME_LENGTH, seedAvatar } from "./accountRules";
import { getViewer } from "./viewer";

const iso = (ms: number) => new Date(ms).toISOString();
const PROFILE_PROJECTION_VERSION = 1;
// Longer than any valid username (3–30) plus room for legacy forms; anything
// longer can't match and isn't worth an index lookup.
const MAX_LOOKUP_LENGTH = 100;

export type PublicProfileRead =
  | { kind: "profile"; profile: PublicProfile }
  | { kind: "redirect"; currentUsername: string }
  | null;

async function activeProfile(ctx: QueryCtx, userId: Doc<"users">["_id"]): Promise<Doc<"profiles"> | null> {
  const user = await ctx.db.get(userId);
  if (!user || user.status !== "active") return null;
  return ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

// The argument is the public name from the URL, not the caller: it is called
// `handle` so the D01 identity-argument scan stays as strict as it is.
async function avatarUrlOf(ctx: QueryCtx, profile: Doc<"profiles">): Promise<string | null> {
  if (profile.avatar?.kind === "external") return profile.avatar.url;
  if (profile.avatar?.kind === "stored") return await ctx.storage.getUrl(profile.avatar.storageId);
  return null;
}

async function toPublic(ctx: QueryCtx, profile: Doc<"profiles">): Promise<PublicProfile> {
  const result: PublicProfile = {
    username: profile.username,
    fullName: profile.fullName ?? null,
    avatarUrl: await avatarUrlOf(ctx, profile),
    createdAt: iso(profile.createdAt),
    updatedAt: iso(profile.updatedAt),
  };
  assertPublicProfile(result);
  return result;
}

export const getPublicByUsername = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }): Promise<PublicProfileRead> => {
    if (handle.length > MAX_LOOKUP_LENGTH) return null;
    const key = usernameKey(handle);
    if (!key) return null;

    const byKey = await ctx.db
      .query("profiles")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", key))
      .first();
    if (byKey) {
      const profile = await activeProfile(ctx, byKey.userId);
      if (!profile) return null;
      return { kind: "profile", profile: await toPublic(ctx, profile) };
    }

    const now = Date.now();
    const previous = await ctx.db
      .query("usernames")
      .withIndex("by_usernameKey_state", (q) => q.eq("usernameKey", key).eq("state", "previous"))
      .collect();
    const live = previous
      .filter((p) => (p.reservedUntil ?? 0) > now)
      .sort((a, b) => (b.reservedUntil ?? 0) - (a.reservedUntil ?? 0))[0];
    if (!live) return null;
    const holder = await activeProfile(ctx, live.userId);
    if (!holder || holder.usernameKey === key) return null;
    return { kind: "redirect", currentUsername: holder.username };
  },
});

const optionalName = v.optional(v.union(v.string(), v.null()));

export type ProfileUpdateResult =
  | { ok: true; profile: PublicProfile }
  | { ok: false; code: "not_signed_in" | "not_found" }
  | { ok: false; code: "invalid" | "taken"; field: string; message: string };

/** A name field: control and format characters dropped, whitespace collapsed, capped; never an address. */
function cleanName(value: string | null | undefined): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  if (cleaned.includes("@")) return { ok: false };
  return { ok: true, value: cleaned ? [...cleaned].slice(0, MAX_NAME_LENGTH).join("") : undefined };
}

/**
 * D04b (P08 R22; P07 §5.3, §5.4): the caller edits their own profile. The
 * caller comes from getViewer only. `currentHandle` is the name in the URL the
 * edit was sent to; if it isn't the caller's current name the answer is
 * not_found, as for anyone else's profile. A rename checks the shared rules
 * and the claim (no other profile holds the key, no other user's reservation
 * is live), then in this one transaction: the profile, the old name's
 * `previous` row with a 90-day reservation, the new `current` row (the
 * caller's own reserved row for that name is revived) and the audit row.
 * No email (D04e: only through the auth provider) and no bio (decided).
 */
export const updateMine = mutation({
  args: {
    currentHandle: v.string(),
    patch: v.object({
      // The new public name (not "username": see getPublicByUsername).
      handle: v.optional(v.string()),
      fullName: optionalName,
      firstName: optionalName,
      lastName: optionalName,
      avatarUrl: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, { currentHandle, patch }): Promise<ProfileUpdateResult> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return { ok: false, code: "not_signed_in" };
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", viewer.userId))
      .first();
    if (!profile || profile.usernameKey !== usernameKey(currentHandle)) return { ok: false, code: "not_found" };

    const now = Date.now();
    const changes: Partial<Doc<"profiles">> = {};
    const unset: ("fullName" | "firstName" | "lastName" | "avatar")[] = [];
    for (const field of ["fullName", "firstName", "lastName"] as const) {
      if (patch[field] === undefined) continue;
      const name = cleanName(patch[field]);
      if (!name.ok) return { ok: false, code: "invalid", field, message: "Names can't contain an email address" };
      if (name.value === undefined) unset.push(field);
      else changes[field] = name.value;
    }
    if (patch.avatarUrl !== undefined) {
      if (patch.avatarUrl === null) unset.push("avatar");
      else {
        const avatar = seedAvatar(patch.avatarUrl);
        if (!avatar) return { ok: false, code: "invalid", field: "avatarUrl", message: "That image address isn't allowed" };
        changes.avatar = avatar;
      }
    }

    if (patch.handle !== undefined && usernameKey(patch.handle) !== profile.usernameKey) {
      const check = checkUsername(patch.handle);
      if (!check.ok) return { ok: false, code: "invalid", field: "username", message: check.message };
      const holder = await ctx.db
        .query("profiles")
        .withIndex("by_usernameKey", (q) => q.eq("usernameKey", check.key))
        .first();
      const current = await ctx.db
        .query("usernames")
        .withIndex("by_usernameKey_state", (q) => q.eq("usernameKey", check.key).eq("state", "current"))
        .first();
      const previous = await ctx.db
        .query("usernames")
        .withIndex("by_usernameKey_state", (q) => q.eq("usernameKey", check.key).eq("state", "previous"))
        .collect();
      const reservedByOther = previous.some((p) => p.userId !== viewer.userId && (p.reservedUntil ?? 0) > now);
      if ((holder && holder._id !== profile._id) || (current && current.userId !== viewer.userId) || reservedByOther) {
        return { ok: false, code: "taken", field: "username", message: USERNAME_TAKEN_MESSAGE };
      }

      const mine = await ctx.db
        .query("usernames")
        .withIndex("by_userId_state", (q) => q.eq("userId", viewer.userId).eq("state", "current"))
        .collect();
      for (const row of mine) {
        await ctx.db.patch(row._id, { state: "previous", releasedAt: now, reservedUntil: now + USERNAME_RESERVATION_MS });
      }
      // Expired claims on the new name (anyone's) and the caller's own
      // reserved row for it are replaced by one current row.
      for (const row of previous) {
        if (row.userId === viewer.userId || (row.reservedUntil ?? 0) <= now) await ctx.db.delete(row._id);
      }
      await ctx.db.insert("usernames", { usernameKey: check.key, userId: viewer.userId, state: "current", claimedAt: now });
      await ctx.db.insert("auditEvents", {
        kind: "username.changed",
        actorId: viewer.userId,
        subjectTable: "profiles",
        subjectId: profile._id,
        at: now,
        details: { from: profile.usernameKey, to: check.key },
      });
      changes.username = check.username;
      changes.usernameKey = check.key;
    } else if (patch.handle !== undefined) {
      // Same key: only the display casing may change.
      const check = checkUsername(patch.handle);
      if (check.ok) changes.username = check.username;
    }

    await ctx.db.patch(profile._id, { ...changes, updatedAt: now });
    if (unset.length) await ctx.db.patch(profile._id, Object.fromEntries(unset.map((f) => [f, undefined])));
    // Owner names and avatars appear in public project results (search outbox, P07 §3.13).
    await ctx.db.insert("contentChanges", {
      entityType: "profile",
      entityId: profile._id,
      change: "upsert",
      sourceVersion: now,
      projectionVersion: PROFILE_PROJECTION_VERSION,
      createdAt: now,
      attempts: 0,
    });
    const updated = (await ctx.db.get(profile._id))!;
    return { ok: true, profile: await toPublic(ctx, updated) };
  },
});
