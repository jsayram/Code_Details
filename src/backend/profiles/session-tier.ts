// D04e (P08 R21): the signed-in user's own tier, from the session only. It
// replaces getUserTier(userId), a callable action that returned any user's
// tier to anyone. Better Auth: users.tier through whoami (P07 §8: own tier
// only). Signed out, no login (D08g4f2), or anything unknown, is "free".
// D08g4i: the Clerk-era Supabase profile branch is gone; it could only answer
// "free". Server-side only.
import { makeFunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";
import { viewerQuery } from "@/lib/auth-server";
import { type ValidTier, isValidTier } from "@/services/tierServiceServer";

const whoami = makeFunctionReference<"query", Record<string, never>, { tier: string } | null>("identity:whoami");

const valid = (tier: string | null | undefined): ValidTier => (tier && isValidTier(tier) ? (tier as ValidTier) : "free");

export async function sessionTier(): Promise<ValidTier> {
  if (chooseAuthBackend().backend === "better-auth") {
    return valid((await viewerQuery(whoami))?.result?.tier);
  }
  return "free";
}
