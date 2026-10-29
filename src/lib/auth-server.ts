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
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";
import { isAdmin } from "@/lib/admin-utils";

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

/**
 * D08g1: the viewer for a request's cookies, for the proxy, where Next's
 * cookies() isn't available. Asks the backend for a Convex token with those
 * cookies (Better Auth checks the session), then resolves it with
 * identity:whoami, so an expired, revoked or deleting session gives null.
 * Null when Better Auth is switched off.
 */
export async function viewerForCookies(cookie: string | null): Promise<{ role: "user" | "admin" } | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth" || !cookie) return null;
  try {
    const res = await fetch(`${choice.convexSiteUrl}/api/auth/convex/token`, { headers: { cookie }, cache: "no-store" });
    const token = res.ok ? ((await res.json()) as { token?: string } | null)?.token : undefined;
    if (!token) return null;
    const viewer = await fetchQuery(whoami, {}, { token, url: choice.convexUrl });
    return viewer ? { role: viewer.role === "admin" ? "admin" : "user" } : null;
  } catch {
    return null;
  }
}

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null; role: string; tier: string } | null>("identity:whoami");

const legacySubject = makeFunctionReference<"query", Record<string, never>, string | null>("identity:legacySubject");

/**
 * D11 (decision A): the user ID the docs and generator routes compare with
 * their data, which is still keyed by Clerk user IDs. With Clerk (the
 * default), exactly Clerk's userId. With the development Better Auth switch
 * on, the request's live session resolved to its account's own Clerk-era
 * subject; null when there is no session or the account has no Clerk-era
 * link, so those routes refuse exactly as they do for a signed-out user.
 * Server-side only.
 */
export async function routeUserId(): Promise<string | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth") {
    return (await auth()).userId;
  }
  try {
    return (await viewerQuery(legacySubject))?.result ?? null;
  } catch {
    return null;
  }
}

/**
 * D02r: the viewer for the personal reads that still query Supabase (my
 * projects, favorites, graveyard, category counts, the dashboard, deleted
 * projects by slug or ID). Identity comes only from the session, never from a
 * query string or an argument. `userId` is routeUserId()'s answer; `isAdmin`
 * is Clerk's email check today (the session's email, as the project page
 * already did) and users.role under the Better Auth switch, as the proxy
 * does since D08g1. Null when nobody is signed in. Server-side only.
 */
export async function routeViewer(): Promise<{ userId: string; isAdmin: boolean } | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth") {
    const { userId, sessionClaims } = await auth();
    if (!userId) return null;
    return { userId, isAdmin: isAdmin(sessionClaims?.email as string | undefined) };
  }
  const userId = await routeUserId();
  if (!userId) return null;
  let admin = false;
  try {
    admin = (await viewerQuery(whoami))?.result?.role === "admin";
  } catch {
    admin = false;
  }
  return { userId, isAdmin: admin };
}
