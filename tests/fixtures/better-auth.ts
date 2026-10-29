// Better Auth over HTTP against the task-owned local Convex backend (D08a).
// Requests go straight to the backend's site port (127.0.0.1:3211), where
// convex/http.ts mounts /api/auth/*, and carry the dev site origin the way a
// browser on localhost:3000 would. Users are synthetic (@synthetic.invalid);
// nothing here reaches a hosted provider or sends email.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";
import { CONVEX_URL, adminClient } from "./convex";

export const SITE_ORIGIN = "http://localhost:3000";
const AUTH = `${TEST_CONVEX_SITE_URL}/api/auth`;

/** Cookies a browser would hold for the auth origin, name -> value. */
export type Jar = Map<string, string>;

function absorb(jar: Jar, res: Response): Jar {
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

export interface AuthCall {
  status: number;
  /** The Location header of a redirect, if any. */
  location?: string;
  body: unknown;
  setCookies: string[];
  jar: Jar;
}

/** One call to a Better Auth endpoint; cookies in `jar` go along and come back updated. */
/**
 * D08e: a client IP for the rate limiter. Without one every request would
 * share a single bucket, so each call gets its own address from the
 * documentation range (2001:db8::/32) unless a test pins one.
 */
let ipCounter = 0;
export const freshClientIp = () => `2001:db8:d08e:${(Date.now() % 0xffff).toString(16)}::${(++ipCounter).toString(16)}`;

export async function authFetch(
  route: string,
  {
    method = "POST",
    body,
    jar = new Map(),
    origin = SITE_ORIGIN,
    ip = freshClientIp(),
  }: { method?: string; body?: unknown; jar?: Jar; origin?: string | null; ip?: string } = {},
): Promise<AuthCall> {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (origin) headers.origin = origin;
  if (jar.size) headers.cookie = cookieHeader(jar);
  if (body !== undefined) headers["content-type"] = "application/json";
  // Never follow redirects: a verify or callback link answers with one, and
  // the test wants to see it (and its cookies), not the page it points to.
  const res = await fetch(`${AUTH}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  return {
    status: res.status,
    location: res.headers.get("location") ?? undefined,
    body: parsed,
    setCookies: res.headers.getSetCookie(),
    jar: absorb(new Map(jar), res),
  };
}

/** The bare sign-up call. With verification required (D08e) it starts no session. */
export const signUpRaw = (email: string, password: string, name = "Synthetic Person", extra: { image?: string } = {}) =>
  authFetch("/sign-up/email", { body: { email, password, name, ...extra } });

/**
 * A synthetic user who signed up, verified the address and signed in, which
 * is what the D08a–d tests mean by "signed up". The verification click is a
 * fixture here; the real email round trip is tested in d08e-login-methods.
 * The result carries the sign-in's cookies and the sign-up's status.
 */
export async function signUp(email: string, password: string, name = "Synthetic Person", extra: { image?: string } = {}): Promise<AuthCall> {
  const raw = await signUpRaw(email, password, name, extra);
  if (raw.status !== 200) return raw;
  await verifyEmail(email);
  const signedIn = await signIn(email, password);
  return { ...signedIn, status: signedIn.status === 200 ? raw.status : signedIn.status };
}
export const signIn = (email: string, password: string, jar: Jar = new Map()) =>
  authFetch("/sign-in/email", { body: { email, password }, jar });
export const signOut = (jar: Jar) => authFetch("/sign-out", { body: {}, jar });

/** The Convex JWT for the session in `jar`, as the Next.js side will fetch it at D08b. */
export async function convexToken(jar: Jar): Promise<string | null> {
  const res = await authFetch("/convex/token", { method: "GET", jar });
  return res.status === 200 ? ((res.body as { token?: string }).token ?? null) : null;
}

export function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
}

export function clientWithToken(token: string): ConvexHttpClient {
  const client = new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true });
  client.setAuth(token);
  return client;
}

let counter = 0;
/** A fresh synthetic address per call, so tests never collide. */
export const syntheticEmail = (label: string) => `d08a.${label}.${Date.now()}.${counter++}@synthetic.invalid`;
export const SYNTHETIC_PASSWORD = "synthetic-Password-123";

const ref = {
  authState: makeFunctionReference<"query", { email: string }>("fixtures:authState"),
  appTablesText: makeFunctionReference<"query">("fixtures:appTablesText"),
  expireSession: makeFunctionReference<"mutation", { sessionId: string; expiresAt?: number }>("fixtures:expireSession"),
  setAccountStatus: makeFunctionReference<"mutation", { authUserId: string; status: "active" | "deleting" }>("fixtures:setAccountStatus"),
  setRole: makeFunctionReference<"mutation", { authUserId: string; role: "user" | "admin" }>("fixtures:setRole"),
  releasePersona: makeFunctionReference<"mutation", { clerkSubject: string }, number>("fixtures:releasePersona"),
  stripCredentials: makeFunctionReference<"mutation", { authUserId: string }>("fixtures:stripCredentials"),
  accountRows: makeFunctionReference<"query", { authUserId: string }>("fixtures:accountRows"),
  repair: makeFunctionReference<"mutation", { createdBefore?: number; createdAfter?: number }>("accounts:repairHalfFinishedSignUps"),
  verifyEmail: makeFunctionReference<"mutation", { email: string }>("fixtures:verifyEmail"),
};

export interface AuthState {
  authUserId: string;
  sessionIds: string[];
  users: { _id: string; authUserId?: string; role: string; tier: string; status: string }[];
  links: { userId: string; provider: string; subject: string }[];
}

export const authState = (email: string): Promise<AuthState | null> => adminClient().query(ref.authState, { email });
export const appTablesText = (): Promise<string> => adminClient().query(ref.appTablesText, {});
export const expireSession = (sessionId: string, expiresAt?: number) =>
  adminClient().mutation(ref.expireSession, expiresAt === undefined ? { sessionId } : { sessionId, expiresAt });
export const setAccountStatus = (authUserId: string, status: "active" | "deleting") =>
  adminClient().mutation(ref.setAccountStatus, { authUserId, status });

export interface AccountRows {
  userId: string;
  profiles: { username: string; usernameKey: string; fullName?: string; firstName?: string; lastName?: string; avatar?: { kind: string; url?: string } }[];
  usernames: { usernameKey: string; state: string }[];
}

/** D11: remove a Clerk-era persona's Better Auth links (undo a handover). */
export const releasePersona = (clerkSubject: string) => adminClient().mutation(ref.releasePersona, { clerkSubject });
export const setRole = (authUserId: string, role: "user" | "admin") => adminClient().mutation(ref.setRole, { authUserId, role });
export const stripCredentials = (authUserId: string) => adminClient().mutation(ref.stripCredentials, { authUserId });
export const accountRows = (authUserId: string): Promise<AccountRows | null> => adminClient().query(ref.accountRows, { authUserId });
export const repairHalfFinishedSignUps = (args: { createdBefore?: number; createdAfter?: number }): Promise<{ removed: number; kept: number }> =>
  adminClient().mutation(ref.repair, args);

export const verifyEmail = (email: string) => adminClient().mutation(ref.verifyEmail, { email });
