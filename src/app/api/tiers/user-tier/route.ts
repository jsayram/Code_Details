import { NextRequest } from "next/server";
import { success } from "@/lib/api-errors";
import { sessionTier } from "@/backend/profiles/session-tier";

/**
 * The signed-in user's own subscription tier.
 * D04e (P08 R21): from the session only (sessionTier); the ?userId= the
 * client hook still sends is ignored, and nobody can read another user's tier.
 * Signed out, the answer is "free", as before.
 */
export async function GET(_request: NextRequest) {
  try {
    return success({ tier: await sessionTier() });
  } catch {
    // Even on error, return a valid JSON response with the default tier
    // Note: Using success with fallback tier for graceful degradation
    return success({ tier: "free", fallback: true });
  }
}
