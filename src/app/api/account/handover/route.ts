// Clerk-session handover (D08d, decided 4A): the account behind the signed-in
// Clerk user takes over the Better Auth login in the same browser. This route
// is the trust boundary: it checks the Clerk session here, on the server, and
// vouches for it to Convex with CODEDETAILS_HANDOVER_SECRET (convex/handover.ts),
// next to the user's own Better Auth token. Convex never sees a Clerk token.
// Development-only while the Better Auth switch is (404 otherwise), and behind
// Clerk's protect() in the proxy like any non-public route.
import { auth } from "@clerk/nextjs/server";
import { chooseAuthBackend } from "@/backend/auth";
import { betterAuthServer } from "@/lib/auth-server";

const refuse = (status: number) => Response.json({ linked: false }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const choice = chooseAuthBackend();
  const helpers = await betterAuthServer();
  if (choice.backend !== "better-auth" || !helpers) return new Response("Not Found", { status: 404 });
  // Same-origin only. Both sessions' cookies are SameSite=Lax already; this
  // also refuses a cross-site fetch that somehow carries them.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse(403);
  const { userId } = await auth();
  if (!userId) return refuse(401);
  const token = await helpers.getToken();
  if (!token) return refuse(401);
  const secret = process.env.CODEDETAILS_HANDOVER_SECRET;
  if (!secret) return refuse(503);
  const res = await fetch(`${choice.convexSiteUrl}/account/handover`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-codedetails-handover-secret": secret, "content-type": "application/json" },
    body: JSON.stringify({ clerkSubject: userId }),
  });
  // Only success or a generic refusal goes back to the browser.
  return res.ok ? Response.json({ linked: true }, { headers: { "cache-control": "no-store" } }) : refuse(409);
}
