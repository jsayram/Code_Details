// Who may sign tokens for this deployment (D01). Everything comes from the
// deployment env, so no issuer is hard-coded: on the task-owned local backend
// tests/convex/push.mjs sets a throwaway synthetic issuer. Pointing a real
// deployment at Clerk (or, after D08, Better Auth) is a separate, reviewed
// configuration step. Convex checks the signature, issuer, audience and
// expiry of every token before ctx.auth sees it.
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      type: "customJwt",
      issuer: process.env.CODEDETAILS_AUTH_ISSUER!,
      jwks: process.env.CODEDETAILS_AUTH_JWKS!,
      applicationID: process.env.CODEDETAILS_AUTH_AUDIENCE!,
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig;
