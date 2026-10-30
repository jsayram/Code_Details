// Who may sign tokens for this deployment (D01, D08a). Convex checks the
// signature, issuer, audience and expiry of every token before ctx.auth sees it.
//
// 1. Better Auth (D08a): tokens minted by the component's convex() plugin,
//    issuer = this deployment's CONVEX_SITE_URL, RS256, audience "convex".
// D08g4c removed the Clerk-era synthetic issuer (D01): Better Auth is the only
// provider.
//
// Trusting a token is not the same as trusting its claims: getViewer
// (convex/viewer.ts) checks which issuer a token came from before it reads
// any claim, because the component's own session lookup doesn't.
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { staticJwks } from "./authRules";

export default {
  providers: [
    // SEC-D08-RL: with JWKS set, the keys are inlined as a data: URI and Convex
    // checks tokens without fetching /api/auth/convex/jwks.
    getAuthConfigProvider({ jwks: staticJwks(process.env.JWKS) }),
  ],
} satisfies AuthConfig;
