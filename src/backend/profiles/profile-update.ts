// D04b: the owner's profile edit on Convex, behind both development switches
// (the same condition as the project writes, projectWritesToConvex). The
// mutation learns the caller from the Better Auth session; this only maps the
// PUT body onto its closed patch. Server-side only.
import { makeFunctionReference } from "convex/server";
import { viewerMutation } from "@/lib/auth-server";
import type { UpdateProfileInput } from "@/types/schemas/profile";
import { type PublicProfile, type PublicProfileRow, rowFromPublicProfile } from "./public-profile";

type Patch = {
  handle?: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
};
type Result =
  | { ok: true; profile: PublicProfile }
  | { ok: false; code: "not_signed_in" | "not_found" }
  | { ok: false; code: "invalid" | "taken"; field: string; message: string };

const updateMine = makeFunctionReference<"mutation", { currentHandle: string; patch: Patch }, Result>("profiles:updateMine");

export type ConvexProfileUpdate =
  | { ok: true; profile: PublicProfileRow }
  | { ok: false; code: "not_signed_in" }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid" | "taken"; field: string; message: string };

export async function updateProfileOnConvex(currentHandle: string, input: UpdateProfileInput): Promise<ConvexProfileUpdate> {
  // Email goes through the auth provider (D04e); there is no bio (P07 §3.3).
  if (input.email_address !== undefined) {
    return { ok: false, code: "invalid", field: "email_address", message: "Change your email address in your account settings" };
  }
  if (input.bio !== undefined && input.bio !== null) {
    return { ok: false, code: "invalid", field: "bio", message: "Profiles have no bio" };
  }
  const patch: Patch = {};
  if (input.username !== undefined) patch.handle = input.username;
  if (input.full_name !== undefined) patch.fullName = input.full_name;
  if (input.first_name !== undefined) patch.firstName = input.first_name;
  if (input.last_name !== undefined) patch.lastName = input.last_name;
  if (input.profile_image_url !== undefined) patch.avatarUrl = input.profile_image_url;
  const answer = await viewerMutation(updateMine, { currentHandle, patch });
  if (!answer) return { ok: false, code: "not_signed_in" };
  const r = answer.result;
  if (r.ok) return { ok: true, profile: rowFromPublicProfile(r.profile) };
  if (r.code === "not_signed_in" || r.code === "not_found") return { ok: false, code: r.code };
  return r;
}
