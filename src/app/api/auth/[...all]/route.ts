// Better Auth's endpoints (D08b), forwarded to the local Convex backend's site
// port. Development-only: while the switch in src/backend/auth is off (always,
// outside development) every path here is a plain 404 and there is no login
// (D08g4f2: the Clerk sync-user route is gone too).
//
// SEC-D08-RL: the server's internal secret header is only ever set by this
// server (src/lib/auth-server.ts); a browser request that carries one has it
// removed before forwarding. SEC-D08-XFF: so are client-IP headers the browser
// supplied (X-Forwarded-For, X-Real-IP, Forwarded), unless
// CODEDETAILS_AUTH_TRUSTED_PROXIES says a trusted proxy in front sets them.
import { betterAuthServer } from "@/lib/auth-server";
import { INTERNAL_AUTH_HEADER } from "../../../../../convex/authRules";

const notFound = () => new Response("Not Found", { status: 404 });

const CLIENT_IP_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded"];

// Rebuilt from its parts: `new Request(request, init)` throws on Next's own
// NextRequest ("Cannot read private member #state").
async function fromBrowser(request: Request): Promise<Request> {
  const drop = [INTERNAL_AUTH_HEADER, ...(process.env.CODEDETAILS_AUTH_TRUSTED_PROXIES?.trim() ? [] : CLIENT_IP_HEADERS)];
  if (!drop.some((h) => request.headers.has(h))) return request;
  const headers = new Headers(request.headers);
  for (const h of drop) headers.delete(h);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  return new Request(request.url, { method: request.method, headers, body, redirect: "manual" });
}

export async function GET(request: Request) {
  const auth = await betterAuthServer();
  return auth ? auth.handler.GET(await fromBrowser(request)) : notFound();
}

export async function POST(request: Request) {
  const auth = await betterAuthServer();
  return auth ? auth.handler.POST(await fromBrowser(request)) : notFound();
}
