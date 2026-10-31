// Signed-in clients for the task-owned local Convex backend. D08g4c: Convex
// trusts Better Auth tokens only (the Clerk-era synthetic issuer is gone), so
// a test acts as a D01 persona through a real Better Auth login linked to that
// persona (fixtures:linkPersona). The admin-key client in ./convex.ts is for
// fixtures and never stands in for a user.
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { CONVEX_URL, fixtureGeneration } from "./convex";
import { SYNTHETIC_PASSWORD, authState, convexToken, linkPersona, signUp, syntheticEmail, unlinkLogin } from "./better-auth";
import { TEST_CONVEX_SITE_URL } from "../support/isolation";

/** What a persona client offers: the calls a signed-in browser makes, typed as ConvexHttpClient's. */
export type PersonaClient = Pick<ConvexHttpClient, "query" | "mutation" | "action">;

type Login = { token: string; authUserId: string };
const logins = new Map<string, { generation: number; login: Promise<Login> }>();

async function loginFor(subject: string): Promise<Login> {
  const email = syntheticEmail("persona");
  const res = await signUp(email, SYNTHETIC_PASSWORD);
  if (res.status !== 200) throw new Error(`persona sign-up failed with ${res.status}`);
  const { authUserId } = (await authState(email))!;
  try {
    await linkPersona(subject, authUserId);
  } catch (e) {
    // Not a fixture persona: a valid login that names no account.
    if (!String(e).includes("no fixture persona")) throw e;
    await unlinkLogin(authUserId);
  }
  const token = await convexToken(res.jar);
  if (!token) throw new Error("persona login has no Convex token");
  return { token, authUserId };
}

function loginOf(subject: string): Promise<Login> {
  const hit = logins.get(subject);
  if (hit && hit.generation === fixtureGeneration) return hit.login;
  const login = loginFor(subject);
  logins.set(subject, { generation: fixtureGeneration, login });
  login.catch(() => logins.delete(subject));
  return login;
}

/** Signs these personas in now, so a later "nothing was written" count doesn't see their first login. */
export async function warmPersonas(subjects: string[]): Promise<void> {
  for (const s of subjects) await loginOf(s);
}

/** The Better Auth user ID behind a persona's login (its token subject). */
export async function personaAuthUserId(subject: string): Promise<string> {
  return (await loginOf(subject)).authUserId;
}

/**
 * Drops the cached logins, for a test that signs a persona out (account
 * deletion revokes its sessions) or links its own login to one.
 */
export function forgetPersonaLogins(): void {
  logins.clear();
}

/**
 * A client signed in as the fixture persona with this Clerk-era `subject` (the
 * persona's Better Auth login is made on first use and reused until the
 * fixtures are cleared or reloaded). Any other subject gets a valid login that
 * names no account, which getViewer treats as nobody.
 */
export function clientAs(subject: string): PersonaClient {
  const client = async () => {
    const c = new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true });
    c.setAuth((await loginOf(subject)).token);
    return c;
  };
  type Call = (fn: FunctionReference<"query" | "mutation" | "action">, args?: Record<string, unknown>) => Promise<unknown>;
  const call = (kind: "query" | "mutation" | "action"): Call => async (fn, args) =>
    ((await client())[kind] as unknown as Call)(fn, args);
  return { query: call("query"), mutation: call("mutation"), action: call("action") } as unknown as PersonaClient;
}

/** A P-256 key the deployment has never seen. */
export function foreignKey(): KeyObject {
  return generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/**
 * A token the deployment must refuse, signed with a key it has never seen:
 * from the removed Clerk-era synthetic issuer by default, or claiming another
 * issuer or audience.
 */
export function forgedToken(subject: string, options: { issuer?: string; audience?: string; extraClaims?: Record<string, unknown> } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid: "forged" };
  const claims = { iss: options.issuer ?? "https://auth.synthetic.invalid", aud: options.audience ?? "codedetails-synthetic", sub: subject, iat: now - 5, exp: now + 300, ...options.extraClaims };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(input), { key: foreignKey(), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** The Better Auth issuer on the test backend (tokens Convex accepts name it). */
export const BETTER_AUTH_ISSUER = TEST_CONVEX_SITE_URL;
