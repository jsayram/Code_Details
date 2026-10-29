// Profile edits against Supabase (D04b, P08 R22). Server-side only; not a
// "use server" module. Callers pass a profile they already resolved from the
// session (the owner's PUT) or an admin-checked action, never a client value.
//
// A rename checks the username rules, then, in one transaction: takes an
// advisory lock on the new key (profiles has no unique index on
// lower(username), so this is what stops two people claiming one name at
// once), checks the key is free (no other profile holds it, case-insensitive,
// and no other user released it less than 90 days ago), writes the profile and
// the username_history row. Keeping the same key (no rename, or only a change
// of case) skips the rules, so a legacy name can still save other fields.
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { executeQuery } from "./server";
import { profiles, type SelectProfile } from "./schema/profiles";
import { usernameHistory } from "./schema/username-history";
import { usernameKey } from "@/backend/profiles/public-profile";
import { USERNAME_RESERVATION_MS, USERNAME_TAKEN_MESSAGE, checkUsername } from "@/backend/profiles/username-rules";

/** The columns a profile edit may write. */
export interface ProfileChanges {
  username?: string;
  full_name?: string | null;
  profile_image_url?: string | null;
  /** Owner's PUT only, until D04e moves email changes to the auth provider. */
  email_address?: string;
  /** Admin only. */
  tier?: string;
}

export type ProfileWriteResult =
  | { ok: true; profile: SelectProfile }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid" | "taken"; message: string };

export async function updateProfileRow(
  match: { userId: string } | { profileId: string },
  changes: ProfileChanges,
  now: Date = new Date(),
): Promise<ProfileWriteResult> {
  return await executeQuery(async (db) =>
    db.transaction(async (tx): Promise<ProfileWriteResult> => {
      const where = "userId" in match ? eq(profiles.user_id, match.userId) : eq(profiles.id, match.profileId);
      const [current] = await tx.select().from(profiles).where(where).for("update");
      if (!current) return { ok: false, code: "not_found" };

      let username: string | undefined;
      if (changes.username !== undefined) {
        const sameKey = usernameKey(changes.username) === usernameKey(current.username);
        if (sameKey) {
          username = changes.username.trim();
        } else {
          const check = checkUsername(changes.username);
          if (!check.ok) return { ok: false, code: "invalid", message: check.message };
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"username:" + check.key}))`);
          const [holder] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(and(eq(sql`lower(${profiles.username})`, check.key), ne(profiles.id, current.id)))
            .limit(1);
          if (holder) return { ok: false, code: "taken", message: USERNAME_TAKEN_MESSAGE };
          const reservedSince = new Date(now.getTime() - USERNAME_RESERVATION_MS);
          const [reserved] = await tx
            .select({ user: usernameHistory.user_id })
            .from(usernameHistory)
            .where(
              and(
                eq(sql`lower(${usernameHistory.old_username})`, check.key),
                ne(usernameHistory.user_id, current.user_id),
                gt(usernameHistory.changed_at, reservedSince),
              ),
            )
            .limit(1);
          if (reserved) return { ok: false, code: "taken", message: USERNAME_TAKEN_MESSAGE };
          // Whatever history the new name had (the user's own old row, or a
          // row whose reservation ran out) goes, so a redirect always points
          // at the latest holder.
          await tx.delete(usernameHistory).where(eq(sql`lower(${usernameHistory.old_username})`, check.key));
          // A legacy email-shaped name gets no history row: the address must
          // never become a redirect key (P07 §5.2).
          if (!current.username.includes("@")) await tx
            .insert(usernameHistory)
            .values({ old_username: current.username, user_id: current.user_id, new_username: check.username, changed_at: now })
            .onConflictDoUpdate({
              target: usernameHistory.old_username,
              set: { user_id: current.user_id, new_username: check.username, changed_at: now },
            });
          username = check.username;
        }
      }

      const [profile] = await tx
        .update(profiles)
        .set({
          ...(username !== undefined && { username }),
          ...(changes.full_name !== undefined && { full_name: changes.full_name }),
          ...(changes.profile_image_url !== undefined && { profile_image_url: changes.profile_image_url }),
          ...(changes.email_address !== undefined && { email_address: changes.email_address }),
          ...(changes.tier !== undefined && { tier: changes.tier }),
          updated_at: now,
        })
        .where(eq(profiles.id, current.id))
        .returning();
      return { ok: true, profile };
    }),
  );
}
