// Server-component SignedIn/SignedOut (D08f2), for pages rendered on the
// server. They do exactly what Clerk's server versions did (read the
// request's session with auth() and render or not), so the server HTML is
// unchanged; there is no hydration step for them to race. Client components
// use ./AuthGate instead.
//
// D08f3a: with the development Better Auth switch on, "signed in" means the
// request's cookies get a Convex token, which checks the Better Auth session.
import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { betterAuthServer } from "@/lib/auth-server";

async function signedIn(): Promise<boolean> {
  const betterAuth = await betterAuthServer();
  if (betterAuth) return betterAuth.isAuthenticated();
  const { userId } = await auth();
  return !!userId;
}

export async function SignedIn({ children }: { children: ReactNode }) {
  return (await signedIn()) ? <>{children}</> : null;
}

export async function SignedOut({ children }: { children: ReactNode }) {
  return (await signedIn()) ? null : <>{children}</>;
}
