// Server-side Better Auth helpers for Next.js (D08b), only while the
// development switch (src/backend/auth) says better-auth. They talk to the
// local Convex backend: `handler` forwards /api/auth/* to its site port, and
// getToken fetches a Convex token with the request's own cookies, which is how
// server code reads as the signed-in user (viewerQuery below).
//
// The component's fetchAuthQuery/preloadAuthQuery aren't used: they find the
// deployment through NEXT_PUBLIC_CONVEX_URL, which this app doesn't set. The
// switch's own loopback URL goes to fetchQuery instead.
//
// The JWT cache stays off: every server render asks Convex for a fresh token,
// so each one re-checks that the session is still live (D08A_REPORT, limits).
import { fetchQuery } from "convex/nextjs";
import type { FunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";

// The package is ESM-only and the root tsconfig resolves app files as
// CommonJS (NodeNext, no "type": "module"; the ts-node scripts depend on that),
// so it is loaded with a dynamic import. Next bundles it either way.
type BetterAuthNext = ReturnType<
  (typeof import("@convex-dev/better-auth/nextjs", { with: { "resolution-mode": "import" } }))["convexBetterAuthNextJs"]
>;

let cached: { key: string; helpers: BetterAuthNext } | null = null;

/** The helpers, or null when Better Auth is switched off. */
export async function betterAuthServer(): Promise<BetterAuthNext | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth") return null;
  const key = `${choice.convexUrl} ${choice.convexSiteUrl}`;
  if (cached?.key !== key) {
    const { convexBetterAuthNextJs } = await import("@convex-dev/better-auth/nextjs");
    cached = { key, helpers: convexBetterAuthNextJs({ convexUrl: choice.convexUrl, convexSiteUrl: choice.convexSiteUrl }) };
  }
  return cached.helpers;
}

/**
 * Runs a Convex query as the request's signed-in user (or anonymously when the
 * request has no live session). Null when Better Auth is switched off.
 */
export async function viewerQuery<Q extends FunctionReference<"query", "public", Record<string, never>>>(
  query: Q,
): Promise<{ result: Q["_returnType"] } | null> {
  const choice = chooseAuthBackend();
  const helpers = await betterAuthServer();
  if (choice.backend !== "better-auth" || !helpers) return null;
  const token = await helpers.getToken();
  return { result: await fetchQuery(query, {}, { token, url: choice.convexUrl }) };
}
