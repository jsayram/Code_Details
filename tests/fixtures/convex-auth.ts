// Signed-in clients for the task-owned local Convex backend (D01). Tokens are
// signed with the throwaway synthetic issuer that tests/convex/push.mjs made
// for this deployment only. This is the one way a test acts as a persona:
// the admin-key client in ./convex.ts is for fixtures and never stands in for
// a user.
import { createPrivateKey, generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { CONVEX_URL } from "./convex";

const ISSUER_FILE = path.resolve(__dirname, "../../.test-runtime/convex/test-issuer.json");

interface TestIssuer {
  issuer: string;
  audience: string;
  kid: string;
  privateJwk: JsonWebKey;
}

export function testIssuerAvailable(): boolean {
  return fs.existsSync(ISSUER_FILE);
}

function readIssuer(): TestIssuer {
  return JSON.parse(fs.readFileSync(ISSUER_FILE, "utf8")) as TestIssuer;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

export interface TokenOptions {
  issuer?: string;
  audience?: string;
  /** Seconds from now; negative for an expired token. */
  expiresIn?: number;
  /** Sign with this key instead of the deployment's (a forged token). */
  key?: KeyObject;
  kid?: string;
}

export function signToken(subject: string, options: TokenOptions = {}): string {
  const issuer = readIssuer();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid: options.kid ?? issuer.kid };
  const claims = {
    iss: options.issuer ?? issuer.issuer,
    aud: options.audience ?? issuer.audience,
    sub: subject,
    iat: now - 5,
    exp: now + (options.expiresIn ?? 300),
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = options.key ?? createPrivateKey({ key: issuer.privateJwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** A P-256 key the deployment has never seen. */
export function foreignKey(): KeyObject {
  return generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
}

/** A client that presents a token for `subject`, as a signed-in browser would. */
export function clientAs(subject: string, options: TokenOptions = {}): ConvexHttpClient {
  const client = new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true });
  client.setAuth(signToken(subject, options));
  return client;
}
