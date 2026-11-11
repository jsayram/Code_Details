// Development-only check of the server-side Better Auth path (D08b): who does
// Convex say the request's session belongs to? The token comes from the
// request's cookies exactly as a server component would get it, and whoami
// resolves it through getViewer. Returns only what whoami returns (no email,
// no IDs). 404 while the Better Auth switch is off. D02r's first signed-in
// read replaces it; D08g removes it at the latest.
import { makeFunctionReference } from "convex/server";
import { viewerQuery } from "@/lib/auth-server";

const whoami = makeFunctionReference<"query", Record<string, never>, { username: string | null; role: string; tier: string } | null>(
  "identity:whoami",
);

export async function GET() {
  const viewer = await viewerQuery(whoami);
  if (!viewer) return new Response("Not Found", { status: 404 });
  return Response.json({ viewer: viewer.result }, { headers: { "cache-control": "no-store" } });
}
