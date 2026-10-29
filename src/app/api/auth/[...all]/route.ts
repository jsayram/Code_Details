// Better Auth's endpoints (D08b), forwarded to the local Convex backend's site
// port. Development-only: while the switch in src/backend/auth is off (always,
// outside development) every path here is a plain 404 and Clerk is the only
// login. The static /api/auth/sync-user route (Clerk) takes precedence over
// this catch-all, so it is unaffected either way.
import { betterAuthServer } from "@/lib/auth-server";

const notFound = () => new Response("Not Found", { status: 404 });

export async function GET(request: Request) {
  const auth = await betterAuthServer();
  return auth ? auth.handler.GET(request) : notFound();
}

export async function POST(request: Request) {
  const auth = await betterAuthServer();
  return auth ? auth.handler.POST(request) : notFound();
}
