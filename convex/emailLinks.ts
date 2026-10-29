// Opaque email-verification links (D08f1, f5). Better Auth 1.6.33's
// verification token is an HS256 JWT whose payload holds the plain email, and
// its link carries that JWT in the query string, so the address ends up in
// every request log the link passes (found in Jose's e9 check). There is no
// option for an opaque token, but the app decides which URL to email:
//
// 1. sendVerificationEmail stores the JWT (and the link's callbackURL) in the
//    component's own verification table under a random single-use code. Only
//    the code's SHA-256 is stored, and the row expires with the JWT.
// 2. The email links to ${SITE_URL}/api/auth/email-link?code=<opaque>.
// 3. That route (registered in convex/http.ts) redeems the code and calls
//    Better Auth's verify-email in-process, so the JWT never reaches a browser
//    URL, the Next.js server or any request log.
//
// Password-reset links are already opaque random IDs and need nothing here.
import { httpAction, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "./_generated/dataModel";
import { TEST_CLIENT_IP_HEADER } from "./authRules";

const IDENTIFIER_PREFIX = "codedetails-email-link:";
const CODE = /^[A-Za-z0-9_-]{43}$/;
export const EMAIL_LINK_PATH = "/api/auth/email-link";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only a callbackURL that stays on the site: a path, never another origin. */
function safeCallback(url: string): string {
  try {
    const callback = new URL(url).searchParams.get("callbackURL") ?? "/";
    return callback.startsWith("/") && !callback.startsWith("//") ? callback : "/";
  } catch {
    return "/";
  }
}

/**
 * Called from Better Auth's sendVerificationEmail with its JWT and link.
 * Returns the opaque link to email instead.
 */
export async function opaqueVerificationLink(ctx: GenericCtx<DataModel>, token: string, url: string, expiresInSeconds: number): Promise<string> {
  if (!("runMutation" in ctx)) throw new Error("verification links can only be made in a mutation or action");
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const code = b64url(bytes);
  await ctx.runMutation(internal.emailLinks.store, {
    codeHash: await sha256Hex(code),
    token,
    callbackURL: safeCallback(url),
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });
  return `${process.env.SITE_URL}${EMAIL_LINK_PATH}?code=${code}`;
}

export const store = internalMutation({
  args: { codeHash: v.string(), token: v.string(), callbackURL: v.string(), expiresAt: v.number() },
  handler: async (ctx, { codeHash, token, callbackURL, expiresAt }) => {
    const now = Date.now();
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "verification",
        data: { identifier: `${IDENTIFIER_PREFIX}${codeHash}`, value: JSON.stringify({ token, callbackURL }), expiresAt, createdAt: now, updatedAt: now },
      },
    });
  },
});

/** Single use: the row is deleted whether or not it was still valid. */
export const redeem = internalMutation({
  args: { codeHash: v.string() },
  handler: async (ctx, { codeHash }): Promise<{ token: string; callbackURL: string } | null> => {
    const where = [{ field: "identifier" as const, value: `${IDENTIFIER_PREFIX}${codeHash}` }];
    const row = (await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "verification", where })) as
      | { value: string; expiresAt: number }
      | null;
    if (!row) return null;
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "verification", where } });
    if (row.expiresAt <= Date.now()) return null;
    return JSON.parse(row.value) as { token: string; callbackURL: string };
  },
});

/** Where a bad, used or expired link lands: Better Auth's own error page. */
const refused = () => new Response(null, { status: 302, headers: { location: "/api/auth/error?error=invalid_link", "cache-control": "no-store" } });

export const emailLinkHttp = httpAction(async (ctx, request) => {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!CODE.test(code)) return refused();
  const link = await ctx.runMutation(internal.emailLinks.redeem, { codeHash: await sha256Hex(code) });
  if (!link) return refused();
  // Imported here, not at the top, because convex/auth.ts imports this module.
  const { createAuth } = await import("./auth");
  const inner = new URL(`${process.env.CONVEX_SITE_URL}/api/auth/verify-email`);
  inner.searchParams.set("token", link.token);
  inner.searchParams.set("callbackURL", link.callbackURL);
  // The client-IP headers go along so the limiter keys this the same way as
  // the request itself (convex/authRules.ts ipAddressOptions decides which count).
  const headers: Record<string, string> = {};
  for (const name of ["x-forwarded-for", TEST_CLIENT_IP_HEADER]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return createAuth(ctx).handler(new Request(inner, { headers }));
});
