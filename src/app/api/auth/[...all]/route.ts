// Better Auth's endpoints (D08b), forwarded to the local Convex backend's site
// port. Development-only: while the switch in src/backend/auth is off (always,
// outside development) every path here is a plain 404 and Clerk is the only
// login. The static /api/auth/sync-user route (Clerk) takes precedence over
// this catch-all, so it is unaffected either way.
//
// SEC-D08-RL: the server's internal secret header is only ever set by this
// server (src/lib/auth-server.ts); a browser request that carries one has it
// removed before forwarding.
import { betterAuthServer } from "@/lib/auth-server";
import { INTERNAL_AUTH_HEADER } from "../../../../../convex/authRules";

const notFound = () => new Response("Not Found", { status: 404 });

function fromBrowser(request: Request): Request {
  if (!request.headers.has(INTERNAL_AUTH_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_AUTH_HEADER);
  return new Request(request, { headers });
}

export async function GET(request: Request) {
  const auth = await betterAuthServer();
  return auth ? auth.handler.GET(fromBrowser(request)) : notFound();
}

export async function POST(request: Request) {
  const auth = await betterAuthServer();
  return auth ? auth.handler.POST(fromBrowser(request)) : notFound();
}
