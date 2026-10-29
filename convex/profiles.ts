// Public profile read on Convex (D04a, P08 R07; P07 §3.3, §5.3, §8). Anonymous
// by design: no identity argument, and it never returns users, emails, roles,
// tiers or provider subjects. A profile is public unless its account is
// deleting or deleted (then it looks missing). A previous username inside its
// 90-day reservation redirects to the holder's current name; after that it
// resolves to nothing until someone claims it.
import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { type PublicProfile, assertPublicProfile, usernameKey } from "../src/backend/profiles/public-profile";

const iso = (ms: number) => new Date(ms).toISOString();
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
      let avatarUrl: string | null = null;
      if (profile.avatar?.kind === "external") avatarUrl = profile.avatar.url;
      else if (profile.avatar?.kind === "stored") avatarUrl = await ctx.storage.getUrl(profile.avatar.storageId);
      const result: PublicProfile = {
        username: profile.username,
        fullName: profile.fullName ?? null,
        avatarUrl,
        createdAt: iso(profile.createdAt),
        updatedAt: iso(profile.updatedAt),
      };
      assertPublicProfile(result);
      return { kind: "profile", profile: result };
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
