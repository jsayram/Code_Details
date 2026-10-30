// Server-component SignedIn/SignedOut (D08f2), for pages rendered on the
// server, so there is no hydration step for them to race. Client components
// use ./AuthGate instead.
//
// D08f3a: "signed in" means the request's cookies get a Convex token, which
// checks the Better Auth session. D08g4f2: Clerk's auth() is gone; with
// Better Auth off nobody is signed in.
import type { ReactNode } from "react";
import { betterAuthSignedIn } from "@/lib/auth-server";

const signedIn = async () => (await betterAuthSignedIn()) === true;

export async function SignedIn({ children }: { children: ReactNode }) {
  return (await signedIn()) ? <>{children}</> : null;
}

export async function SignedOut({ children }: { children: ReactNode }) {
  return (await signedIn()) ? null : <>{children}</>;
}
