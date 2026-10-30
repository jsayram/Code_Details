// D04e (P08 R21): the signed-in user's own tier, from the session only. It
// replaces getUserTier(userId), a callable action that returned any user's
// tier to anyone. Clerk mode: the session user's Supabase profile. Better Auth
// switch: users.tier through whoami (P07 §8: own tier only). Signed out, or
// anything unknown, is "free". Server-side only.
import { makeFunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";
import { routeViewer, viewerQuery } from "@/lib/auth-server";
import { readTierByUserId } from "@/db/profile-read";
import { type ValidTier, isValidTier } from "@/services/tierServiceServer";

const whoami = makeFunctionReference<"query", Record<string, never>, { tier: string } | null>("identity:whoami");

const valid = (tier: string | null | undefined): ValidTier => (tier && isValidTier(tier) ? (tier as ValidTier) : "free");

export async function sessionTier(): Promise<ValidTier> {
  if (chooseAuthBackend().backend === "better-auth") {
    return valid((await viewerQuery(whoami))?.result?.tier);
  }
  const viewer = await routeViewer();
  if (!viewer) return "free";
  return valid(await readTierByUserId(viewer.userId));
}
