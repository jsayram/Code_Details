import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { betterAuthEnabled } from "@/backend/auth";
import { betterAuthDecision, hasSessionCookie } from "@/backend/auth/proxy-rules";
import { viewerForCookies } from "@/lib/auth-server";

const isPublicRoute = createRouteMatcher([
        "/",  // Allow access to the root page
        "/sign-in(.*)", 
        "/sign-up(.*)",
        "/shared-projects/(.*)",  // Added (.*) to handle any trailing segments
        "/projects/:slug",
        "/projects/users/:username(.*)",  // Added (.*) to handle any trailing segments
        "/api/shared-projects/(.*)",  // Added (.*) to handle any trailing segments
        "/api/webhook/clerk", // Allow Clerk webhook endpoint
        "/api/auth/sync-user", // Allow sync endpoint (prevent auth loop)
]);

// D08b: Better Auth's own endpoints and the dev viewer check, public only
// while its development switch is on (src/backend/auth). Off, they stay behind
// Clerk exactly as before, and the routes answer 404 anyway.
const isBetterAuthRoute = createRouteMatcher(["/api/auth/(.*)", "/api/dev/viewer"]);

const isAdminRoute = createRouteMatcher([
  "/dashboard/admin(.*)",
  "/dashboard/tag-submissions(.*)", // D07 (P08 R04): its read was admin-checked; now the route is too
  "/api/projects/test(.*)",
  "/api/darkmodetest(.*)",
  "/api/toasttest(.*)",
]);

import { ADMIN_CACHE_TTL_MS, USER_SYNC_DEBOUNCE_MS } from "@/constants/project-limits";

// Simple in-memory cache for admin checks (expires after 5 minutes)
const adminCache = new Map<string, { isAdmin: boolean; timestamp: number }>();
const CACHE_TTL = ADMIN_CACHE_TTL_MS;

// Sync deduplication cache - prevents redundant user sync calls
const syncCache = new Map<string, number>(); // userId -> last sync timestamp
const SYNC_DEBOUNCE_TIME = USER_SYNC_DEBOUNCE_MS;

function isAdminCached(userId: string, userEmail: string | undefined): boolean {
  const cached = adminCache.get(userId);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.isAdmin;
  }
  
  const adminEmail = process.env.ADMIN_DASHBOARD_MODERATOR;
  const isAdmin = !!(adminEmail && userEmail?.toLowerCase().trim() === adminEmail.toLowerCase().trim());
  
  adminCache.set(userId, { isAdmin, timestamp: now });
  return isAdmin;
}

function shouldSyncUser(userId: string): boolean {
  const lastSync = syncCache.get(userId);
  const now = Date.now();
  
  if (lastSync && (now - lastSync) < SYNC_DEBOUNCE_TIME) {
    return false; // Recently synced, skip
  }
  
  syncCache.set(userId, now);
  return true;
}

// D08g1: with the development Better Auth switch on, protected routes need a
// live Better Auth session instead of a Clerk one, and admin routes need
// users.role "admin". Still inside clerkMiddleware so Clerk's own server
// helpers keep working until D08g4. Clerk's user sync doesn't run here.
async function betterAuthProxy(req: NextRequest) {
  const isPublic = isPublicRoute(req) || isBetterAuthRoute(req);
  const cookie = req.headers.get("cookie");
  const viewer = isPublic || !hasSessionCookie(cookie) ? null : await viewerForCookies(cookie);
  const decision = betterAuthDecision({
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    isPublic,
    isAdmin: isAdminRoute(req),
    viewer,
  });
  if (decision.kind === "redirect") return NextResponse.redirect(new URL(decision.location, req.url));
  if (decision.kind === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  return NextResponse.next();
}

export default clerkMiddleware(async (auth, req) => {
  if (betterAuthEnabled()) return betterAuthProxy(req);

  const { userId } = await auth();

  // Check admin routes first
  if (isAdminRoute(req)) {
    if (!userId) {
      // Not signed in, redirect to sign-in
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    try {
      // Get user's email from Clerk with error handling
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const userEmail = user.emailAddresses[0]?.emailAddress;

      // Check if user is admin using cache
      if (!isAdminCached(userId, userEmail)) {
        // Not admin, redirect to regular dashboard or home
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
      // Admin verified, continue to admin route
    } catch (error) {
      // If Clerk API fails (rate limit or other error), check cache
      const cached = adminCache.get(userId);
      if (cached && cached.isAdmin) {
        // Use cached admin status if available
        console.warn('Using cached admin status due to Clerk API error');
      } else {
        // If no cache and API fails, redirect to dashboard for safety
        console.error('Clerk API error in middleware:', error);
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
  }

  // Only trigger sync for actual page navigation requests
  // Skip API routes, Server Actions, data requests, and other internal Next.js paths
  const pathname = req.nextUrl.pathname;
  const shouldSkipSync = 
    pathname.startsWith('/api') ||           // API routes
    pathname.startsWith('/_next/') ||        // Next.js internals (includes Server Actions)
    pathname.includes('__nextDataReq') ||    // Data requests
    pathname.startsWith('/_vercel/') ||      // Vercel internals
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|json|woff|woff2|ttf|eot)$/); // Static files
  
  // Only sync if:
  // 1. User is authenticated
  // 2. Not a skipped path type
  // 3. User hasn't been synced recently (deduplication)
  if (userId && !shouldSkipSync && shouldSyncUser(userId)) {
    fetch(`${req.nextUrl.origin}/api/auth/sync-user`, {
      method: 'POST',
      // The visitor's own session cookies: sync-user reads identity from
      // them and ignores any body (D01, R06).
      headers: { cookie: req.headers.get('cookie') ?? '' },
    }).catch(() => {
      // Silently fail - sync will happen on next request
    });
  }

  if (!isPublicRoute(req) && !(isBetterAuthRoute(req) && betterAuthEnabled())) {
    await auth.protect();
  }
}) as any; // Type assertion for Next.js 16 proxy compatibility

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
