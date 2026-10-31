// Server-side Better Auth helpers for Next.js (D08b), only while the
// development switch (src/backend/auth) says better-auth. They talk to the
// local Convex backend: `handler` forwards /api/auth/* to its site port, and
// serverToken fetches a Convex token with the request's own cookies, which is
// how server code reads as the signed-in user (viewerQuery below).
//
// The component's fetchAuthQuery/preloadAuthQuery aren't used: they find the
// deployment through NEXT_PUBLIC_CONVEX_URL, which this app doesn't set. The
// switch's own loopback URL goes to fetchQuery instead.
//
// The JWT cache stays off: every server render asks Convex for a fresh token,
// so each one re-checks that the session is still live (D08A_REPORT, limits).
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { headers } from "next/headers";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { chooseAuthBackend } from "@/backend/auth";
import { INTERNAL_AUTH_HEADER } from "../../convex/authRules";

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
 * SEC-D08-RL: a Convex token for these cookies, fetched by this server from the
 * auth site. It sends only the cookie and the internal secret
 * (CODEDETAILS_INTERNAL_AUTH_SECRET, server env), never the browser's other
 * headers, so a client's X-Forwarded-For can't pick a rate-limit bucket, and
 * the auth site lets these calls past the limiter that would otherwise put
 * every user's check into one shared bucket. The session cookie is still
 * checked there. Null without a live session.
 */
async function serverToken(convexSiteUrl: string, cookie: string | null): Promise<string | null> {
  if (!cookie) return null;
  const headers: Record<string, string> = { cookie, "accept-encoding": "identity" };
  const secret = process.env.CODEDETAILS_INTERNAL_AUTH_SECRET;
  if (secret) headers[INTERNAL_AUTH_HEADER] = secret;
  const res = await fetch(`${convexSiteUrl}/api/auth/convex/token`, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return ((await res.json()) as { token?: string } | null)?.token ?? null;
}

async function requestCookie(): Promise<string | null> {
  return (await headers()).get("cookie");
}

/**
 * Runs a Convex query as the request's signed-in user (or anonymously when the
 * request has no live session). Null when Better Auth is switched off.
 */
export async function viewerQuery<Q extends FunctionReference<"query", "public", Record<string, never>>>(
  query: Q,
): Promise<{ result: Q["_returnType"] } | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth") return null;
  const token = await serverToken(choice.convexSiteUrl, await requestCookie());
  return { result: await fetchQuery(query, {}, { token: token ?? undefined, url: choice.convexUrl }) };
}

/**
 * D02: runs a Convex mutation as the request's signed-in user, with a token
 * fetched by this server (serverToken, as viewerQuery does). Its arguments
 * are never an identity (the no-identity-args test). Null when Better Auth is
 * switched off or the request has no live session, so nothing runs
 * anonymously.
 */
export async function viewerMutation<Args extends Record<string, unknown>, R>(
  mutation: FunctionReference<"mutation", "public", Args, R>,
  args: Args,
): Promise<{ result: R } | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth") return null;
  const token = await serverToken(choice.convexSiteUrl, await requestCookie());
  if (!token) return null;
  const ref = mutation as unknown as FunctionReference<"mutation", "public", Record<string, unknown>, R>;
  return { result: (await fetchMutation(ref, args, { token, url: choice.convexUrl })) as R };
}

/** Whether the request has a live Better Auth session (a token comes back); null when the switch is off. */
export async function betterAuthSignedIn(): Promise<boolean | null> {
  const choice = chooseAuthBackend();
  if (choice.backend !== "better-auth") return null;
  try {
    return !!(await serverToken(choice.convexSiteUrl, await requestCookie()));
  } catch {
    return false;
  }
}

/**
 * viewerQuery for a query that takes arguments (D02r-c). The arguments are
 * never an identity: the no-identity-args test refuses any such query.
 */
export async function viewerQueryWithArgs<Args extends Record<string, unknown>, R>(
  query: FunctionReference<"query", "public", Args, R>,
  args: Args,
): Promise<{ result: R } | null> {
  const choice = chooseAuthBackend();
  const helpers = await betterAuthServer();
  if (choice.backend !== "better-auth" || !helpers) return null;
  const token = await helpers.getToken();
  const ref = query as unknown as FunctionReference<"query", "public", Record<string, unknown>, R>;
  return { result: (await fetchQuery(ref, args, { token, url: choice.convexUrl })) as R };
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
    const token = await serverToken(choice.convexSiteUrl, cookie);
    if (!token) return null;
    const viewer = await fetchQuery(whoami, {}, { token, url: choice.convexUrl });
    return viewer ? { role: viewer.role === "admin" ? "admin" : "user" } : null;
  } catch {
    return null;
  }
}

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null; role: string; tier: string } | null>("identity:whoami");

/**
 * D07-c: the Better Auth viewer's users.role, for the admin checks. It needs
 * no Clerk-era link, so an account that signed up with Better Auth can be an
 * admin. Null when signed out, on any error, or with
 * the switch off.
 */
export async function betterAuthRole(): Promise<string | null> {
  try {
    return (await viewerQuery(whoami))?.result?.role ?? null;
  } catch {
    return null;
  }
}

const docOwnerQuery = makeFunctionReference<"query", Record<string, never>, { userId: string } | null>("identity:docOwner");

/**
 * Who the generated-docs code may treat as an owner (generator re-key).
 * `writeKey` is the key a new doc is written with; `keys` are every key the
 * caller owns docs under: the session's own Convex account ID. Null when
 * nobody is signed in, or with Better Auth off (D08g4f2). Identity comes only
 * from the session. Server-side only; never sent to the client. E03: the
 * Clerk-era key (`legacyUserId`) and `projectViewer` are gone with the clerk
 * links and the Supabase reads.
 */
export type DocOwner = {
  writeKey: string;
  keys: string[];
};

export async function routeDocOwner(): Promise<DocOwner | null> {
  if (chooseAuthBackend().backend !== "better-auth") return null;
  let owner: { userId: string } | null = null;
  try {
    owner = (await viewerQuery(docOwnerQuery))?.result ?? null;
  } catch {
    owner = null;
  }
  if (!owner?.userId) return null;
  return { writeKey: owner.userId, keys: [owner.userId] };
}

// E03: routeUserId and routeViewer (the Clerk-era viewer for the Supabase
// reads) are gone with those reads.
