import { NextResponse, type NextRequest } from "next/server";
import { betterAuthEnabled } from "@/backend/auth";
import { betterAuthDecision, hasSessionCookie, isAdminPath, isBetterAuthPath, isPublicPath } from "@/backend/auth/proxy-rules";
import { viewerForCookies } from "@/lib/auth-server";

// D08g1: protected routes need a live Better Auth session, and admin routes
// need users.role "admin". D08g4f2: Clerk's middleware and its user sync are
// gone, so this is the only path. With Better Auth off (production builds,
// development without local Convex URLs) nobody is signed in: public routes
// pass, protected pages go to /sign-in, protected APIs answer 401.
export default async function proxy(req: NextRequest) {
  const enabled = betterAuthEnabled();
  const pathname = req.nextUrl.pathname;
  const isPublic = isPublicPath(pathname) || (enabled && isBetterAuthPath(pathname));
  const cookie = req.headers.get("cookie");
  const viewer = !enabled || isPublic || !hasSessionCookie(cookie) ? null : await viewerForCookies(cookie);
  const decision = betterAuthDecision({ pathname, search: req.nextUrl.search, isPublic, isAdmin: isAdminPath(pathname), viewer });
  if (decision.kind === "redirect") return NextResponse.redirect(new URL(decision.location, req.url));
  if (decision.kind === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  const next = NextResponse.next();
  // H1: an API answer behind sign-in is never for a shared cache (CDN, proxy).
  // Public and auth routes set their own headers.
  if (!isPublic && (pathname === "/api" || pathname.startsWith("/api/"))) next.headers.set("cache-control", "private, no-store");
  return next;
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
