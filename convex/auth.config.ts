// Who may sign tokens for this deployment (D01, D08a). Convex checks the
// signature, issuer, audience and expiry of every token before ctx.auth sees it.
//
// 1. Better Auth (D08a): tokens minted by the component's convex() plugin,
//    issuer = this deployment's CONVEX_SITE_URL, RS256, audience "convex".
// 2. The Clerk-era synthetic issuer (D01): on the task-owned local backend
//    tests/convex/push.mjs sets a throwaway issuer; it goes away with Clerk
//    (D08g). Nothing in code names a real issuer.
//
// Trusting a token is not the same as trusting its claims: getViewer
// (convex/viewer.ts) checks which issuer a token came from before it reads
// any claim, because the component's own session lookup doesn't.
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    getAuthConfigProvider(),
    {
      type: "customJwt",
      issuer: process.env.CODEDETAILS_AUTH_ISSUER!,
      jwks: process.env.CODEDETAILS_AUTH_JWKS!,
      applicationID: process.env.CODEDETAILS_AUTH_AUDIENCE!,
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig;
