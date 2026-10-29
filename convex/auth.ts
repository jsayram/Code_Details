// Better Auth on Convex (D08a). The component keeps Better Auth's own tables
// (user, session, account, verification, jwks); this file is the only place
// that configures it.
//
// Login methods are not decided yet (D08e). Email and password is switched on
// only where the deployment env says CODEDETAILS_AUTH_EMAIL_PASSWORD=1, which
// tests/convex/push.mjs sets on the task-owned test backend for synthetic
// users. Everywhere else no method is enabled.
//
// Every value comes from the deployment env: BETTER_AUTH_SECRET (a throwaway
// on the test backend), SITE_URL (where browsers reach /api/auth) and the
// built-in CONVEX_SITE_URL (the token issuer). Telemetry is off.
import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

// Typed explicitly: internal.auth's type is derived from this module, which
// would otherwise make authComponent's type depend on itself.
const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      // Runs in the same transaction as the component's insert of the auth
      // user, so the app account and its link exist as soon as the auth user
      // does. A new auth user is always a new account: nothing here looks for
      // an existing one by email (P07 §3.2). Linking Clerk-era accounts is
      // D08d. The profile row (handle, seeded name/avatar) arrives with D08c.
      onCreate: async (ctx, authUser) => {
        const existing = await ctx.db
          .query("authLinks")
          .withIndex("by_provider_subject", (q) => q.eq("provider", "better-auth").eq("subject", authUser._id))
          .unique();
        if (existing) return;
        const now = Date.now();
        const userId = await ctx.db.insert("users", {
          authUserId: authUser._id,
          role: "user",
          tier: "free",
          status: "active",
          createdAt: now,
        });
        await ctx.db.insert("authLinks", { userId, provider: "better-auth", subject: authUser._id, linkedAt: now });
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
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: process.env.CODEDETAILS_AUTH_EMAIL_PASSWORD === "1",
      requireEmailVerification: false,
    },
    telemetry: { enabled: false },
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
