// Better Auth on Convex (D08a). The component keeps Better Auth's own tables
// (user, session, account, verification, jwks); this file is the only place
// that configures it.
//
// Login methods (Jose, 2026-10-28, 1A): email/password with verification and
// reset, plus GitHub. Each is switched on by the deployment env, so a
// deployment without it offers nothing:
// - email/password: CODEDETAILS_AUTH_EMAIL_PASSWORD=1 (the test backend sets it
//   for synthetic users). Verification is required; the opt-out
//   CODEDETAILS_AUTH_REQUIRE_EMAIL_VERIFICATION="0" works only on a loopback
//   backend (convex/authRules.ts). Emails go through convex/email.ts
//   (loopback only for now).
// - GitHub: only when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are both set.
// Accounts are never joined by email (P07 §3.2): linking is explicit only.
//
// Every value comes from the deployment env: BETTER_AUTH_SECRET (a throwaway
// on the test backend), SITE_URL (where browsers reach /api/auth), optional
// CODEDETAILS_AUTH_TRUSTED_ORIGINS (comma-separated extra app origins, e.g. the
// browser-test server; D08b) and the built-in CONVEX_SITE_URL (the token
// issuer). Telemetry is off.
import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { createAccountRows } from "./accounts";
import { emailVerificationRequired } from "./authRules";
import { opaqueVerificationLink } from "./emailLinks";
import { sendAuthEmail } from "./email";
import authConfig from "./auth.config";

// Typed explicitly: internal.auth's type is derived from this module, which
// would otherwise make authComponent's type depend on itself.
const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      // Runs in the same transaction as the component's insert of the auth
      // user, so the app account, its link, profile and handle exist as soon
      // as the auth user does (convex/accounts.ts, D08c). A new auth user is
      // always a new account: nothing here looks for an existing one by email
      // (P07 §3.2). Linking Clerk-era accounts is D08d. There is deliberately
      // no onUpdate: provider name/avatar changes never reach the profile.
      onCreate: async (ctx, authUser) => {
        await createAccountRows(ctx, authUser);
      },
      // Deleting an auth user leaves the app account in place; the account
      // lifecycle (14-day grace, purge, removing links) is D04d. Without a
      // link the account no longer resolves, so getViewer returns null.
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL,
    trustedOrigins: (process.env.CODEDETAILS_AUTH_TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: process.env.CODEDETAILS_AUTH_EMAIL_PASSWORD === "1",
      requireEmailVerification: emailVerificationRequired(process.env),
      sendResetPassword: async ({ user, url }) => sendAuthEmail("reset-password", user.email, url),
      resetPasswordTokenExpiresIn: 60 * 60,
      // A reset signs out every other session of that user.
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      // f5: email an opaque single-use link instead of Better Auth's, whose
      // JWT carries the address in the URL (convex/emailLinks.ts).
      sendVerificationEmail: async ({ user, url, token }) =>
        sendAuthEmail("verify-email", user.email, await opaqueVerificationLink(ctx, token, url, 60 * 60)),
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
    },
    socialProviders:
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET } }
        : {},
    // Never join accounts by email (Jose, 2026-10-29, 4A). A GitHub sign-in
    // whose email already has an account is refused (the browser lands on the
    // error URL with error=account_not_linked; D08f shows "sign in with your
    // password, then connect GitHub from settings"). Connecting GitHub is only
    // explicit: link-social while signed in, and only for the same address.
    account: { accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false } },
    // Better Auth's limiter is off outside production by default, and its
    // in-memory store wouldn't survive between Convex function runs, so it is
    // switched on with the component's rateLimit table. Limits are per client
    // IP from x-forwarded-for; CODEDETAILS_AUTH_TRUSTED_PROXIES lists the proxy
    // hops (comma-separated IPs/CIDRs) to strip, e.g. the Next.js server.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/*": { window: 60, max: 10 },
        "/sign-up/*": { window: 60, max: 10 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
      },
    },
    advanced: {
      ipAddress: {
        trustedProxies: (process.env.CODEDETAILS_AUTH_TRUSTED_PROXIES ?? "").split(",").filter(Boolean),
      },
    },
    telemetry: { enabled: false },
    // D08f3b: errors that end in a redirect (a refused GitHub sign-in, a bad
    // or used email link via /api/auth/error) land on the app's own screen,
    // which shows wording for the ?error= code and nothing else. Relative, so
    // the browser stays on the origin it came through (the app's /api/auth).
    onAPIError: { errorURL: "/sign-in/error" },
    plugins: [
      convex({
        authConfig,
        // The token carries only what Convex needs: sub (the auth user ID),
        // sessionId, iss, aud, iat, exp. By default the plugin copies the
        // whole auth user, email included, into every token (P07 §5.5).
        jwt: { definePayload: () => ({}) },
      }),
    ],
  });
